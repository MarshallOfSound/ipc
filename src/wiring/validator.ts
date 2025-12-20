import { Controller } from '../controller';
import { Validator, ValidatorGrammar, ValidatorNestedCondition } from '../schema-type';
import { eventValidator } from './_constants';

type VariableType = 'Boolean' | 'String';
const variables: Record<string, { depends_on_url: true; type: VariableType; custom_expression?: string } | { depends_on_url: false; renderer_depends_on_webframe: boolean; browser: string; renderer: string | null; type: VariableType }> = {
  is_main_frame: {
    depends_on_url: false,
    renderer_depends_on_webframe: true,
    browser: 'event.senderFrame?.parent === null',
    renderer: 'webFrame.top?.routingId === webFrame.routingId',
    type: 'Boolean',
  },
  is_packaged: {
    depends_on_url: false,
    renderer_depends_on_webframe: false,
    browser: '$$app$$.isPackaged',
    renderer: null,
    type: 'Boolean'
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
};

interface ConditionFlags {
  renderer_depends_on_web_frame: boolean;
  depends_on_url: boolean;
}

interface ConditionGrammar extends ConditionFlags {
  grammar: string;
}

function buildGrammar(grammar: ValidatorGrammar, process: 'browser' | 'renderer', flags: ConditionFlags): string {
  switch (grammar.operation) {
    case 'And': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, flags)).join(' && ')})`;
    }
    case 'Or': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, flags)).join(' || ')})`;
    }
  }
}

function buildCondition(condition: ValidatorNestedCondition, process: 'browser' | 'renderer', flags: ConditionFlags): string {
  switch (condition.operation) {
    case 'And': {
      return buildGrammar(condition, process, flags);
    }
    case 'Or': {
      return buildGrammar(condition, process, flags);
    }
    case 'Is': {
      const { subject, target } = condition;
      if (!Object.prototype.hasOwnProperty.call(variables, subject)) {
        throw new Error(`Unsupported variable "${subject}" in conditional`);
      }

      const info = variables[subject];
      if (info.depends_on_url) {
        flags.depends_on_url = true;
      } else if (info.renderer_depends_on_webframe) {
        flags.renderer_depends_on_web_frame = true;
      }

      if (info.type !== target.type) {
        throw new Error(`Variable "${subject}" of type "${info.type}" can not be compared against a literal of type "${target.type}"`);
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

      return `((${expression}) === ${target.type === 'String' ? JSON.stringify(target.value) : target.value})`;
    }
    case 'DynamicGlobal': {
      const { param } = condition;
      // For renderer checks just expose and then the browser process will nuke the request
      if (process === 'renderer') {
        return '(true)';
      }
      return `(!!(globalThis as any)[${JSON.stringify(param)}])`;
    }
  }
}

export function wireValidator(validator: Validator, controller: Controller): void {
  let grammar: ValidatorGrammar;
  if (validator.grammar.type === 'ValidatorStructure') {
    const validatorToUse = process.env.EIPC_ENV ||  process.env.NODE_ENV || 'production';
    const found = validator.grammar.validators.find(v => v.name === validatorToUse);
    if (!found) {
      throw new Error(`Had an environment dependant validator, but could not find the "${validatorToUse}" definition, either add that definition or set EIPC_ENV or NODE_ENV to the correct environment name`);
    }
    grammar = found.grammar;
  } else {
    grammar = validator.grammar;
  }

  let dependencies: ConditionFlags = { depends_on_url: false, renderer_depends_on_web_frame: false };
  const browserCondition = buildGrammar(grammar, 'browser', dependencies);
  const browserEventValidator = [
    `function ${eventValidator(validator.name)}(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {`,
    ...(dependencies.depends_on_url ? ['  if (!event.senderFrame) return false;', '  const url = new URL(event.senderFrame.url);'] : []),
    `  if (${browserCondition}) return true;`,
    '  return false;',
    '}',
  ];

  dependencies = { depends_on_url: false, renderer_depends_on_web_frame: false }
  const rendererCondition = buildGrammar(grammar, 'renderer', dependencies);
  const rendererExposeValidator = [
    `function ${eventValidator(validator.name)}() {`,
    ...(dependencies.depends_on_url ? ['  const url = new URL(window.location.href);'] : []),
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
