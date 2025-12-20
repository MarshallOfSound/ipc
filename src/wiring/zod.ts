import { Controller } from '../controller';
import { ZodReference } from '../schema-type';
import { validator } from './_constants';

export const wireZod = (zod: ZodReference, controller: Controller) => {
  controller.addCommonCode([`import type { ${zod.typeName.value} } from "${zod.file.value}";`, `export { ${zod.typeName.value} };`].join('\n'));
  controller.addCommonRuntimeCode(
    [
      `import { ${zod.schemaName.value} } from "${zod.file.value}";`,
      `export function ${validator(zod.name)}(value: unknown) {`,
      `  return ${zod.schemaName.value}.safeParse(value).success;`,
      `}`,
    ].join('\n'),
  );
  controller.addCommonExport(zod.typeName.value);
  controller.addCommonRuntimeExport(validator(zod.name));
};
