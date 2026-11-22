/**
 * Re-export shim.
 *
 * The email/SMS providers and the template engine now live in the shared
 * workspace package `@subtrackr/notification-providers` so that the Expo
 * backend and the standalone `services/notification` microservice can both
 * use them without either project importing the other's sources.
 */
export * from '@subtrackr/notification-providers';
