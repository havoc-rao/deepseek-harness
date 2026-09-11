import { Context, Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import { InvocationDescriptor, TypertContextRegistry, TypertDisposer, TypertLocalRegistry, TypertLookupRegistry, TypertRegistryContract, TypertRemoteRegistry } from "@deepseek-ai/dsh-typert-protocol";

//#region src/types.d.ts
/** Independently compiled side that produced a contribution. */
type TypertFace = 'host' | 'client';
/** Structured JSDoc tag retained by generated runtime metadata. */
interface TypertDocTag {
  readonly name: string;
  readonly argument?: string;
  readonly comment?: string;
  readonly text: string;
}
/** Source documentation retained on reflected package elements. */
interface TypertDocumentation {
  readonly description?: string;
  readonly summary?: string;
  readonly tags: readonly TypertDocTag[];
  readonly jsDoc?: string;
}
/** One generated public member signature. */
interface TypertMemberModel {
  readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index';
  readonly name: string;
  readonly signature: string;
  readonly summary?: string;
  readonly jsDoc?: string;
}
/** One named type declaration referenced by a reflected business surface. */
interface TypertTypeModel {
  readonly name: string;
  readonly declaration: string;
}
/** Runtime reflection metadata for one Cordis service. */
interface TypertServiceModel extends TypertDocumentation {
  readonly key: string;
  readonly exportName: string;
  readonly members: readonly TypertMemberModel[];
  readonly types: readonly TypertTypeModel[];
}
/** Runtime reflection metadata for one Cordis event. */
interface TypertEventModel extends TypertDocumentation {
  readonly name: string;
  readonly mode?: string;
  readonly signature: string;
}
/** Runtime reflection metadata for one explicitly exported reference object. */
interface TypertObjectModel extends TypertDocumentation {
  readonly name: string;
  readonly exportName: string;
  readonly members: readonly TypertMemberModel[];
  readonly types: readonly TypertTypeModel[];
}
/** Generated business reflection for one package on one face. */
interface TypertPackageModel {
  readonly services: readonly TypertServiceModel[];
  readonly events: readonly TypertEventModel[];
  readonly objects: readonly TypertObjectModel[];
}
/** One generated live Zod schema. */
interface TypertSchema {
  readonly name: string;
  readonly schema: z.ZodType;
}
/** One generated package contribution registered and withdrawn atomically. */
interface TypertContribution {
  readonly package: string;
  readonly face: TypertFace;
  readonly schemas: readonly TypertSchema[];
  readonly model: TypertPackageModel;
  /** Host invocation definitions, empty when the package exports no Remote methods. */
  readonly invocations: readonly InvocationDescriptor[];
}
/** A live schema plus its contribution identity. */
interface TypertSchemaRecord extends TypertSchema {
  readonly package: string;
  readonly face: TypertFace;
  readonly key: string;
}
/** A live generated package model plus its stable identity. */
interface TypertPackageRecord {
  readonly package: string;
  readonly face: TypertFace;
  readonly key: string;
  readonly model: TypertPackageModel;
}
/** Filter for schema enumeration. */
interface TypertSchemaFilter {
  readonly package?: string;
  readonly face?: TypertFace;
}
/** Filter for package-model enumeration. */
interface TypertPackageFilter {
  readonly package?: string;
  readonly face?: TypertFace;
}
//#endregion
//#region src/service.d.ts
/**
 * Compose the global key of one generated schema.
 * @param packageName - contributing npm package.
 * @param name - schema export name.
 * @returns `<package>#<name>`.
 */
declare function typertKey(packageName: string, name: string): string;
/**
 * Compose the identity of one package-face model.
 * @param packageName - contributing npm package.
 * @param face - independently compiled face.
 * @returns `<package>#<face>`.
 */
declare function typertPackageKey(packageName: string, face: TypertFace): string;
/**
 * Compose the endpoint key used by local and Remote invocation registries.
 * @param descriptor - invocation whose namespace and method form the endpoint.
 * @returns `<namespace>/<method>`.
 */
declare function typertEndpoint(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string;
/**
 * Registry of generated schemas, package reflection, invocations, and Remote
 * dependency providers.
 * @typert service typert
 */
declare class TypertRegistry extends Service implements TypertRegistryContract {
  private readonly schemas;
  private readonly packages;
  private readonly localStore;
  private readonly remoteStore;
  private readonly lookupStore;
  private readonly contextStore;
  constructor(ctx: Context);
  /** Current-environment invocation definitions. */
  get local(): TypertLocalRegistry;
  /** Consumer-selected Remote definitions. */
  get remotes(): TypertRemoteRegistry;
  /** Host object lookup providers. */
  get lookups(): TypertLookupRegistry;
  /** Host Context providers and Client Context binders. */
  get contexts(): TypertContextRegistry;
  /**
   * Register one generated contribution atomically for the calling fiber.
   * Duplicate package-face identities, schemas, invocation ids, or endpoints
   * reject the whole batch.
   * @param contribution - generated schemas, reflection, and Host invocations.
   * @returns the exact effect disposer that removes this contribution.
   */
  register(contribution: TypertContribution): TypertDisposer;
  /**
   * Look up one schema by `<package>#<name>`.
   * @param key - global schema key.
   * @returns the live schema record, or `undefined` when absent.
   */
  get(key: string): TypertSchemaRecord | undefined;
  /**
   * Resolve one required schema.
   * @param key - global schema key.
   * @returns the live schema record.
   * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
   */
  resolve(key: string): TypertSchemaRecord;
  /**
   * Enumerate live schemas in registration order.
   * @param filter - optional package and face restriction.
   * @returns matching schema records.
   */
  list(filter?: TypertSchemaFilter): TypertSchemaRecord[];
  /**
   * Look up generated reflection for one package face.
   * @param packageName - exact npm package name.
   * @param face - face to query; defaults to the host runtime.
   * @returns the live package record, or `undefined` when absent.
   */
  getPackage(packageName: string, face?: TypertFace): TypertPackageRecord | undefined;
  /**
   * Enumerate generated package reflection in registration order.
   * @param filter - optional package and face restriction.
   * @returns matching package records.
   */
  listPackages(filter?: TypertPackageFilter): TypertPackageRecord[];
  /**
   * Project a live Zod schema to JSON Schema without caching the result.
   * @param key - global schema key.
   * @param params - Zod projection parameters.
   * @returns a fresh JSON Schema document.
   */
  toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema;
  private validatePackage;
  private validateSchemas;
}
//#endregion
//#region src/index.d.ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRegistryContract {
    register(contribution: TypertContribution): TypertDisposer;
    get(key: string): TypertSchemaRecord | undefined;
    resolve(key: string): TypertSchemaRecord;
    list(filter?: TypertSchemaFilter): TypertSchemaRecord[];
    getPackage(packageName: string, face?: TypertFace): TypertPackageRecord | undefined;
    listPackages(filter?: TypertPackageFilter): TypertPackageRecord[];
    toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema;
  }
} //# sourceMappingURL=index.d.ts.map
//#endregion
export { type TypertContribution, type TypertDocTag, type TypertDocumentation, type TypertEventModel, type TypertFace, type TypertMemberModel, type TypertObjectModel, type TypertPackageFilter, type TypertPackageModel, type TypertPackageRecord, TypertRegistry, TypertRegistry as default, type TypertSchema, type TypertSchemaFilter, type TypertSchemaRecord, type TypertServiceModel, type TypertTypeModel, typertEndpoint, typertKey, typertPackageKey };
//# sourceMappingURL=index.d.mts.map