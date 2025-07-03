import { Controller } from '../controller';
import { Array, Enum, KeyValueMap, Structure, StructureProperty } from '../schema-type';
import { basePrimitives, INLINE_STRUCTURE_JOINER, validator } from './_constants';
import { getTSForIdentifier } from './identifier';

const validatorFnOrPrimitiveValidator = (property: StructureProperty | KeyValueMap, inlineStructureName: string) => {
  if (property.value.type === 'Identifier') {
    return validatorFnOrPrimitiveValidatorForType(property.value.name, `value.${property.key}`);
  }
  if (property.value.type === 'Array') {
    return `(Array.isArray(value.${property.key}) && value.${property.key}.every((v: any) => ${validatorFnOrPrimitiveValidatorForType(property.value.name, 'v')}))`;
  }
  if (property.value.type === 'IdentifierIDX') {
    return `(supgee)`;
  }
  return `${validator(inlineStructureName)}(value.${property.key})`;
};

const validatorFnOrPrimitiveValidatorForType = (type: string, jsValueName: string) => {
  if (basePrimitives.includes(type)) {
    if (type === 'unknown') {
      return 'true';
    }
    return `(typeof ${jsValueName} === '${type}')`;
  }
  return `${validator(type)}(${jsValueName})`;
};

export function wireKeyValueMap(kvm: KeyValueMap, pseduoName: string, controller: Controller): void {
  const getInlineStructureName = () => `${pseduoName}${INLINE_STRUCTURE_JOINER}_$MappedValue$_`;

  const inlineStructureName = getInlineStructureName();
  let valueName: string;
  switch (kvm.value.type) {
    case 'InlineStructure': {
      wireStructure(
        {
          type: 'Structure',
          name: inlineStructureName,
          properties: kvm.value.properties,
        },
        controller,
        false,
      );
      valueName = inlineStructureName;
      break;
    }
    case 'KeyValueBlock': {
      wireKeyValueMap(kvm.value, inlineStructureName, controller);
      valueName = inlineStructureName;
      break;
    }
    case 'IdentifierIDX':
    case 'Array':
    case 'Identifier': {
      valueName = getTSForIdentifier(kvm.value);
      break;
    }
  }

  const structureDeclaration = [`export type ${pseduoName} = Record<${kvm.key}, ${valueName}>;`];

  const structureValidatorDeclaration = [
    `export function ${validator(pseduoName)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    `  for (const key of Object.keys(value)) {`,
    `    if (!${validatorFnOrPrimitiveValidatorForType(kvm.key, 'key')}) return false;`,
    `    if (!${validatorFnOrPrimitiveValidatorForType(valueName, 'value[key]')}) return false`,
    `  }`,
    `  return true;`,
    `}`,
  ];

  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonRuntimeCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(pseduoName);
  controller.addCommonRuntimeExport(validator(pseduoName));
}

function maybeNullable(s: string, nullable: boolean) {
  if (nullable) {
    return `(${s}) | null`;
  }
  return s;
}

export function wireStructure(structure: Structure, controller: Controller, exported = true): void {
  const getInlineStructureName = (propertyKey: string) => `${structure.name}${INLINE_STRUCTURE_JOINER}${propertyKey}`;
  const structureDeclaration = [
    `export interface ${structure.name} {`,
    ...structure.properties.map(
      (property) =>
        {
          const keyPrefix = `  ${property.key}${property.optional ? '?' : ''}`;
          if (property.value.type === 'Identifier' || property.value.type === 'IdentifierIDX' || property.value.type === 'Array') {
            return `${keyPrefix}: ${maybeNullable(getTSForIdentifier(property.value), property.nullable)};`
          }
          return `${keyPrefix}: ${maybeNullable(getInlineStructureName(property.key), property.nullable)};`
        }
    ),
    '}',
  ];

  const structureValidatorDeclaration = [
    `export function ${validator(structure.name)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    ...structure.properties.map((property) => {
      const inlineStructureName = getInlineStructureName(property.key);


      if (property.value.type === 'InlineStructure') {
        wireStructure(
          {
            type: 'Structure',
            name: inlineStructureName,
            properties: property.value.properties,
          },
          controller,
          false,
        );
      } else if (property.value.type === 'KeyValueBlock') {
        wireKeyValueMap(property.value, inlineStructureName, controller);
      }

      return [
        '',
        `  // ${structure.name}.${property.key}`,
        ...(property.optional ? [`  if (typeof value.${property.key} !== 'undefined') {`] : []),
        `  if (${property.nullable ? `value.${property.key} !== null && ` : ''}!${validatorFnOrPrimitiveValidator(property, inlineStructureName)}) return false;`,
        ...(property.optional ? [`  }`] : []),
      ].join('\n');
    }),
    `  return true;`,
    `}`,
  ];
  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonRuntimeCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(structure.name);
  controller.addCommonRuntimeExport(validator(structure.name));
  if (exported) controller.addPublicCommonExport(structure.name);
}
