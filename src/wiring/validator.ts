import { Controller } from '../controller';
import { Validator, ValidatorGrammar, ValidatorNestedCondition } from '../schema-type';
import { eventValidator } from './_constants';

type VariableType = 'Boolean' | 'String';
const variables: Record<string, { depends_on_url: true; type: VariableType } | { depends_on_url: false; browser: string; renderer: string | null; type: VariableType }> = {
  is_main_frame: {
    depends_on_url: false,
    browser: 'event.senderFrame?.parent === null',
    renderer: 'window.top === window',
    type: 'Boolean',
  },
  is_packaged: {
    depends_on_url: false,
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

interface UrlDependency {
  depends: boolean;
}

function buildGrammar(grammar: ValidatorGrammar, process: 'browser' | 'renderer', dep: UrlDependency): string {
  switch (grammar.operation) {
    case 'And': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, dep)).join(' && ')})`;
    }
    case 'Or': {
      return `(${grammar.conditions.map((condition) => buildCondition(condition, process, dep)).join(' || ')})`;
    }
  }
}

function buildCondition(condition: ValidatorNestedCondition, process: 'browser' | 'renderer', dep: UrlDependency): string {
  switch (condition.operation) {
    case 'And': {
      return buildGrammar(condition, process, dep);
    }
    case 'Or': {
      return buildGrammar(condition, process, dep);
    }
    case 'Is': {
      const { subject, target } = condition;
      if (!Object.prototype.hasOwnProperty.call(variables, subject)) {
        throw new Error(`Unsupported variable "${subject}" in conditional`);
      }

      const info = variables[subject];
      if (info.depends_on_url) {
        dep.depends = true;
      }

      if (info.type !== target.type) {
        throw new Error(`Variable "${subject}" of type "${info.type}" can not be compared against a literal of type "${target.type}"`);
      }

      if (!info.depends_on_url && info[process] === null) {
        return `(true)`;
      }

      return `((${info.depends_on_url ? `url.${subject}` : info[process]}) === ${target.type === 'String' ? JSON.stringify(target.value) : target.value})`;
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

  const dependsOnUrl: UrlDependency = { depends: false };
  const browserCondition = buildGrammar(grammar, 'browser', dependsOnUrl);
  const browserEventValidator = [
    `function ${eventValidator(validator.name)}(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {`,
    ...(dependsOnUrl.depends ? ['  if (!event.senderFrame) return false;', '  const url = new URL(event.senderFrame.url);'] : []),
    `  if (${browserCondition}) return true;`,
    '  return false;',
    '}',
  ];

  dependsOnUrl.depends = false;
  const rendererCondition = buildGrammar(grammar, 'renderer', dependsOnUrl);
  const rendererExposeValidator = [
    `function ${eventValidator(validator.name)}() {`,
    ...(dependsOnUrl.depends ? ['  const url = new URL(window.location.href);'] : []),
    `  if (${rendererCondition}) return true;`,
    '  return false;',
    '}',
  ];

  controller.addBrowserCode(browserEventValidator.join('\n'));
  controller.addPreloadCode(rendererExposeValidator.join('\n'));
}
