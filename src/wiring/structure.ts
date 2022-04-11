import { Controller } from '../controller';
import { Enum, Structure, StructureProperty } from '../schema-type';
import { basePrimitives, INLINE_STRUCTURE_JOINER, validator } from './_constants';

const validatorFnOrPrimitiveValidator = (property: StructureProperty, inlineStructureName: string) => {
  if (typeof property.value === 'string') {
    if (basePrimitives.includes(property.value)) return `(typeof value.${property.key} === '${property.value}')`;
    return `${validator(property.value as string)}(value.${property.key})`;
  }
  return `${validator(inlineStructureName)}(value.${property.key})`;
};

export function wireStructure(structure: Structure, controller: Controller, exported = true): void {
  const getInlineStructureName = (propertyKey: string) => `${structure.name}${INLINE_STRUCTURE_JOINER}${propertyKey}`;
  const structureDeclaration = [
    `export interface ${structure.name} {`,
    ...structure.properties.map(
      (property) => `  ${property.key}${property.optional ? '?' : ''}: ${typeof property.value === 'object' ? getInlineStructureName(property.key) : property.value};`,
    ),
    '}',
  ];

  const structureValidatorDeclaration = [
    `export function ${validator(structure.name)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    ...structure.properties.map((property) => {
      const inlineStructureName = getInlineStructureName(property.key);

      if (typeof property.value === 'object') {
        wireStructure(
          {
            type: 'Structure',
            name: inlineStructureName,
            properties: property.value.properties,
          },
          controller,
          false,
        );
      }

      return [
        '',
        `  // ${structure.name}.${property.key}`,
        ...(property.optional ? [`  if (typeof value.${property.key} !== 'undefined') {`] : []),
        `  if (!${validatorFnOrPrimitiveValidator(property, inlineStructureName)}) return false;`,
        ...(property.optional ? [`  }`] : []),
      ].join('\n');
    }),
    `  return true;`,
    `}`,
  ];
  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(structure.name);
  controller.addCommonExport(validator(structure.name));
  if (exported) controller.addPublicCommonExport(structure.name);
}
