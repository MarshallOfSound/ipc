grammar Eipc

entry Module:
    'module' name=QualifiedName
    (elements+=ModuleElement)*;

// NamePart allows IDs and keywords that might be used as names
NamePart returns string:
    ID | 'string' | 'number' | 'boolean' | 'validator' | 'enum' | 'structure' | 'subtype' | 'interface' | 'module' | 'startsWith' | 'type';

QualifiedName returns string:
    NamePart ('.' NamePart)*;

// TypeIdentifier allows both regular IDs and primitive type keywords
TypeIdentifier returns string:
    NamePart;

ModuleElement:
    Validator | Interface | Enum | Structure | SubType | ZodReference;

// ============ Validators ============

Validator:
    'validator' name=ID '=' grammar=ValidatorGrammarOrStructure;

ValidatorGrammarOrStructure:
    ValidatorStructure | ValidatorGrammar;

ValidatorStructure:
    '{' (options+=ValidatorOption)+ '}';

ValidatorOption:
    name=ID optional?='?'? ':' grammar=ValidatorGrammar;

ValidatorGrammar:
    ValidatorAnd | ValidatorOr;

ValidatorAnd:
    'AND(' (conditions+=ValidatorStatement)+ ')';

ValidatorOr:
    'OR(' (conditions+=ValidatorStatement)+ ')';

ValidatorStatement:
    ValidatorIs | ValidatorStartsWith | ValidatorDynamicGlobal | ValidatorGrammar;

ValidatorIs:
    subject=ID 'is' value=StringOrBoolean;

ValidatorStartsWith:
    subject=ID 'startsWith' value=STRING;

ValidatorDynamicGlobal:
    'dynamic_global(' param=ID ')';

StringOrBoolean:
    StringValue | BooleanValue;

StringValue:
    value=STRING;

BooleanValue:
    value=('true' | 'false');

// ============ Enums ============

Enum:
    'enum' name=ID '{' (options+=EnumOption)+ '}';

EnumOption:
    name=ID ('=' value=STRING)?;

// ============ Structures ============

Structure:
    'structure' name=ID block=StructureBlock;

StructureBlock:
    '{' (properties+=StructureProperty)+ '}';

StructureProperty:
    name=NamePart optional?='?'? ':' type=PropertyType nullable?='?'?;

PropertyType:
    TypeReference | StructureBlock | KeyValueBlock;

TypeReference:
    reference=TypeIdentifier array?='[]'?;

KeyValueBlock:
    '{' 'string' '->' type=PropertyType '}';

// ============ SubTypes ============

SubType:
    'subtype' name=ID '=' parent=TypeIdentifier '(' (restrictions+=SubTypeRestriction)+ ')';

SubTypeRestriction:
    name=NamePart ':' value=LiteralValue;

LiteralValue:
    StringValue | BooleanValue | NumberValue;

NumberValue:
    value=NUMBER;

// ============ Zod References ============

ZodReference:
    'zod_reference' name=ID '{'
        'import' '=' file=STRING
        'type' '=' typeName=STRING
        'schema' '=' schemaName=STRING
    '}';

// ============ Interfaces ============

Interface:
    (tags+=BlockTag)*
    'interface' name=ID '{' (methods+=Method)* '}';

BlockTag:
    '[' key=ID ('=' value=ID)? ']';

Method:
    (tags+=BlockTag)*
    name=ID '(' (arguments+=Argument (',' arguments+=Argument)*)? ')' returnType=ReturnType?;

Argument:
    name=NamePart optional?='?'? ':' type=TypeReference nullable?='?'?;

ReturnType:
    '->' type=TypeReference nullable?='?'?;

// ============ Terminals ============

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

terminal ID: /[_a-zA-Z][\w_]*/;
terminal STRING: /"[^"]*"/;
terminal NUMBER returns number: /-?[0-9]+/;
