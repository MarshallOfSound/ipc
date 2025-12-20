import { Controller } from '../controller.js';
import type { Enum } from '../language/generated/ast.js';
import { validator } from './_constants.js';

export function wireEnum(enumBlock: Enum, controller: Controller): void {
  // In Langium AST, EnumOption has 'name' and optional 'value'
  // If value is not specified, use the name as the value
  const enumDeclaration = [
    `export enum ${enumBlock.name} {`,
    ...enumBlock.options.map((option) => {
      const value = option.value ? option.value.replace(/^"|"$/g, '') : option.name;
      return `  ${option.name} = "${value}",`;
    }),
    '}',
  ];

  const enumValidatorDeclaration = [
    `const ${validator(enumBlock.name)}_values = new Set([${enumBlock.options
      .map((option) => {
        const value = option.value ? option.value.replace(/^"|"$/g, '') : option.name;
        return `"${value}"`;
      })
      .join(',')}]);`,
    `export function ${validator(enumBlock.name)}(value: any): boolean {`,
    `  return ${validator(enumBlock.name)}_values.has(value);`,
    `}`,
  ];

  controller.addCommonCode(enumDeclaration.join('\n'));
  controller.addCommonRuntimeCode(enumValidatorDeclaration.join('\n'));
  controller.addCommonExport(enumBlock.name);
  controller.addCommonRuntimeExport(validator(enumBlock.name));
}
