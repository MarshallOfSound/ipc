export type Schema = {
  type: 'Module';
  name: string;
  body: (Validator | SubType | Enum | Structure | Interface | ZodReference)[];
};

/** Begin Zod Reference */
export type ZodReference = {
  type: 'ZodReference';
  name: string;
  file: StringValue;
  typeName: StringValue;
  schemaName: StringValue;
}
/** End Zod Reference */

/** Begin Validator */
export type Validator = {
  type: 'Validator';
  name: string;
  grammar: ValidatorGrammar;
};

export type ValidatorGrammar = ValidatorAndCondition | ValidatorOrCondition;

export type ValidatorNestedCondition = ValidatorAndCondition | ValidatorIsCondition | ValidatorOrCondition;

export type ValidatorAndCondition = {
  type: 'Condition';
  operation: 'And';
  conditions: ValidatorNestedCondition[];
};

export type ValidatorOrCondition = {
  type: 'Condition';
  operation: 'Or';
  conditions: ValidatorNestedCondition[];
};

export type ValidatorIsCondition = {
  type: 'Condition';
  operation: 'Is';
  subject: string;
  target: ValidatorTarget;
};

export type ValidatorTarget = StringValue | BooleanValue;
/** End Validator */

/** Begin SubType */
export type SubType = {
  type: 'SubType';
  name: string;
  parent: string;
  restrictions: SubTypeRestriction[];
};

export type SubTypeRestriction = {
  name: string;
  value: StringValue | BooleanValue | NumberValue;
};
/** End SubTupe */

/** Begin Enum */
export type Enum = {
  type: 'Enum';
  name: string;
  options: EnumOption[];
};

export type EnumOption = {
  key: string;
  value: string;
};
/** End Enum */

/** Begin Structure */
export type Structure = {
  type: 'Structure';
  name: string;
  properties: StructureProperty[];
};

export type KeyValueMap = {
  type: 'KeyValueBlock';
  key: 'string';
  value: Identifier | Array | IdentifierIDX | InlineStructure | KeyValueMap;
}

export type Identifier = {
  type: 'Identifier';
  name: string;
}

export type IdentifierIDX = {
  type: 'IdentifierIDX',
  name: string;
  idxKey: Identifier;
}

export type Array = {
  type: 'Array',
  name: string;
}

export type StructureProperty = {
  key: string;
  value: Identifier | Array | IdentifierIDX | InlineStructure | KeyValueMap;
  optional: boolean;
  nullable: boolean;
};

export type InlineStructure = {
  type: 'InlineStructure';
  properties: StructureProperty[];
};
/** End Structure */

/** Begin Interface */
export type Interface = {
  type: 'Interface';
  name: string;
  tags: BlockTag[];
  methods: InterfaceMethod[];
};

export type BlockTag = {
  type: 'BlockTag';
  key: string;
  value?: string;
};

export type InterfaceMethod = {
  type: 'Method';
  name: string;
  tags: BlockTag[];
  arguments: MethodArgument[];
  /**
   * null implies the method waits for completion but will not send any return value
   * if one is provided it is dropped rather than being validated
   */
  returns: {
    type: Identifier | Array | IdentifierIDX;
    nullable: boolean;
  } | null;
};

export type MethodArgument = {
  type: 'Argument';
  name: string;
  argType: Identifier | Array | IdentifierIDX;
  nullable: boolean;
};
/** End Interface */

/** Begin Generic */
export type StringValue = {
  type: 'String';
  value: string;
};

export type BooleanValue = {
  type: 'Boolean';
  value: boolean;
};

export type NumberValue = {
  type: 'Number';
  value: number;
};
/** End Generic */
