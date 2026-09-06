/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as auth from "../auth.js";
import type * as browserMutation from "../browserMutation.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as maintenance from "../maintenance.js";
import type * as mcpOAuth from "../mcpOAuth.js";
import type * as mcpPlanner from "../mcpPlanner.js";
import type * as planner from "../planner.js";
import type * as plannerApplication from "../plannerApplication.js";
import type * as plannerGuards from "../plannerGuards.js";
import type * as plannerStore from "../plannerStore.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  auth: typeof auth;
  browserMutation: typeof browserMutation;
  crons: typeof crons;
  http: typeof http;
  maintenance: typeof maintenance;
  mcpOAuth: typeof mcpOAuth;
  mcpPlanner: typeof mcpPlanner;
  planner: typeof planner;
  plannerApplication: typeof plannerApplication;
  plannerGuards: typeof plannerGuards;
  plannerStore: typeof plannerStore;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
