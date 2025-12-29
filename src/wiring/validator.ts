import { Controller } from '../controller.js';
import type {
  Validator,
  ValidatorGrammar,
  ValidatorStatement,
  ValidatorAnd,
  ValidatorOr,
  ValidatorIs,
  ValidatorStartsWith,
  ValidatorDynamicGlobal,
} from '../language/generated/ast.js';
import { eventValidator } from './_constants.js';

type VariableType = 'Boolean' | 'String';
const variables: Record<
  string,
  | { depends_on_url: true; type: VariableType; custom_expression?: string }
  | { depends_on_url: false; renderer_depends_on_webframe: boolean; browser: string; renderer: string | null; type: VariableType }
> = {
  is_main_frame: {
    depends_on_url: false,
    renderer_depends_on_webframe: true,
    browser: 'event.senderFrame?.parent === null',
    renderer: 'webFrame.top?.frameToken === webFrame.frameToken',
    type: 'Boolean',
  },
  is_packaged: {
    depends_on_url: false,
    renderer_depends_on_webframe: false,
    browser: '$$app$$.isPackaged',
    renderer: null,
    type: 'Boolean',
  },
  protocol: {
    depends_on_url: true,
    type: 'String',
  },
  origin: {
    depends_on_url: true,
    // Custom protocols (app://, custom://) return null for url.origin
    // We need to compute it manually as protocol + '//' + host
    custom_expression: '(url.origin === "null" || url.origin === null ? `${url.protocol}//${url.host}` : url.origin)',
    type: 'String',
  },
  href: {
    depends_on_url: true,
    type: 'String',
  },
  hostname: {
    depends_on_url: true,
    type: 'String',
  },
  is_about_blank: {
    depends_on_url: false,
    renderer_depends_on_webframe: false,
    browser: "event.senderFrame?.url === 'about:blank'",
    renderer: "window.location.href === 'about:blank'",
    type: 'Boolean',
  },
};

interface ConditionFlags {
  renderer_depends_on_web_frame: boolean;
  depends_on_url: boolean;
}

const availableVariables = Object.keys(variables);
const booleanVariables = Object.entries(variables)
  .filter(([_, v]) => v.type === 'Boolean')
  .map(([k]) => k);
const stringVariables = Object.entries(variables)
  .filter(([_, v]) => v.type === 'String')
  .map(([k]) => k);

function buildGrammar(grammar: ValidatorGrammar, process: 'browser' | 'renderer', flags: ConditionFlags): string {
  switch (grammar.$type) {
    case 'ValidatorAnd': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, flags)).join(' && ')})`;
    }
    case 'ValidatorOr': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, flags)).join(' || ')})`;
    }
  }
}

function buildCondition(condition: ValidatorStatement, process: 'browser' | 'renderer', flags: ConditionFlags): string {
  switch (condition.$type) {
    case 'ValidatorAnd':
    case 'ValidatorOr': {
      return buildGrammar(condition, process, flags);
    }
    case 'ValidatorIs': {
      const { subject, value } = condition;
      if (!Object.prototype.hasOwnProperty.call(variables, subject)) {
        throw new Error(`Unknown variable "${subject}" in validator condition.\n\n` + `Available variables: ${availableVariables.join(', ')}`);
      }

      const info = variables[subject];
      if (info.depends_on_url) {
        flags.depends_on_url = true;
      } else if (info.renderer_depends_on_webframe) {
        flags.renderer_depends_on_web_frame = true;
      }

      const targetType = value.$type === 'StringValue' ? 'String' : 'Boolean';
      if (info.type !== targetType) {
        const validVars = targetType === 'Boolean' ? booleanVariables : stringVariables;
        throw new Error(`Variable "${subject}" is a ${info.type}, but you're comparing it to a ${targetType}.\n\n` + `${targetType} variables: ${validVars.join(', ')}`);
      }

      if (!info.depends_on_url && info[process] === null) {
        return `(true)`;
      }

      // Use custom_expression if defined (e.g., for origin with custom protocols)
      let expression: string;
      if (info.depends_on_url) {
        expression = info.custom_expression ?? `url.${subject}`;
      } else {
        expression = info[process] as string;
      }

      const targetValue = value.$type === 'StringValue' ? JSON.stringify(value.value.replace(/^"|"$/g, '')) : value.value === 'true';
      return `((${expression}) === ${targetValue})`;
    }
    case 'ValidatorStartsWith': {
      const { subject, value } = condition;
      if (!Object.prototype.hasOwnProperty.call(variables, subject)) {
        throw new Error(`Unknown variable "${subject}" in validator condition.\n\n` + `Available variables: ${availableVariables.join(', ')}`);
      }

      const info = variables[subject];
      if (info.depends_on_url) {
        flags.depends_on_url = true;
      } else if (!info.depends_on_url && info.renderer_depends_on_webframe) {
        flags.renderer_depends_on_web_frame = true;
      }

      if (info.type !== 'String') {
        throw new Error(
          `Cannot use "startsWith" with "${subject}" - it's a ${info.type}, not a String.\n\n` + `String variables that support startsWith: ${stringVariables.join(', ')}`,
        );
      }

      if (!info.depends_on_url && info[process] === null) {
        return `(true)`;
      }

      let expression: string;
      if (info.depends_on_url) {
        expression = info.custom_expression ?? `url.${subject}`;
      } else {
        expression = info[process] as string;
      }

      const cleanValue = value.replace(/^"|"$/g, '');
      return `((${expression}).startsWith(${JSON.stringify(cleanValue)}))`;
    }
    case 'ValidatorDynamicGlobal': {
      const { param } = condition;
      // For renderer checks just expose and then the browser process will nuke the request
      if (process === 'renderer') {
        return '(true)';
      }
      return `(!!(globalThis as any)[${JSON.stringify(param)}])`;
    }
  }
}

export function wireValidator(validatorDef: Validator, controller: Controller): void {
  let grammar: ValidatorGrammar;
  if (validatorDef.grammar.$type === 'ValidatorStructure') {
    const validatorToUse = process.env.EIPC_ENV || process.env.NODE_ENV || 'production';
    const found = validatorDef.grammar.options.find((v) => v.name === validatorToUse);
    if (!found) {
      throw new Error(
        `Had an environment dependant validator, but could not find the "${validatorToUse}" definition, either add that definition or set EIPC_ENV or NODE_ENV to the correct environment name`,
      );
    }
    grammar = found.grammar;
  } else {
    grammar = validatorDef.grammar;
  }

  let dependencies: ConditionFlags = { depends_on_url: false, renderer_depends_on_web_frame: false };
  const browserCondition = buildGrammar(grammar, 'browser', dependencies);
  const browserEventValidator = [
    `function ${eventValidator(validatorDef.name)}(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {`,
    ...(dependencies.depends_on_url
      ? ['  if (!event.senderFrame) return false;', '  let url: URL;', '  try {', '    url = new URL(event.senderFrame.url);', '  } catch {', '    return false;', '  }']
      : []),
    `  if (${browserCondition}) return true;`,
    '  return false;',
    '}',
  ];

  dependencies = { depends_on_url: false, renderer_depends_on_web_frame: false };
  const rendererCondition = buildGrammar(grammar, 'renderer', dependencies);
  const rendererExposeValidator = [
    `function ${eventValidator(validatorDef.name)}() {`,
    ...(dependencies.depends_on_url ? ['  let url: URL;', '  try {', '    url = new URL(window.location.href);', '  } catch {', '    return false;', '  }'] : []),
    `  if (${rendererCondition}) return true;`,
    '  return false;',
    '}',
  ];

  controller.addBrowserCode(browserEventValidator.join('\n'));
  controller.addPreloadCode(rendererExposeValidator.join('\n'));
  if (dependencies.renderer_depends_on_web_frame) {
    controller.addPreloadImport(`import { webFrame } from "electron/renderer";`);
  }
}
