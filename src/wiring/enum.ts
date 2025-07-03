import { Controller } from '../controller';
import { Enum } from '../schema-type';
import { validator } from './_constants';

export function wireEnum(enumBlock: Enum, controller: Controller): void {
  const enumDeclaration = [`export enum ${enumBlock.name} {`, ...enumBlock.options.map((option) => `  ${option.key} = "${option.value}",`), '}'];

  const enumValidatorDeclaration = [
    `const ${validator(enumBlock.name)}_values = new Set([${enumBlock.options.map(({ value }) => `"${value}"`).join(',')}]);`,
    `export function ${validator(enumBlock.name)}(value: any): value is ${enumBlock.name} {`,
    `  return ${validator(enumBlock.name)}_values.has(value);`,
    `}`,
  ];
  controller.addCommonCode(enumDeclaration.join('\n'));
  controller.addCommonRuntimeCode(enumValidatorDeclaration.join('\n'));
  controller.addCommonExport(enumBlock.name);
  controller.addCommonRuntimeExport(validator(enumBlock.name));
  controller.addPublicCommonExport(enumBlock.name);
}
