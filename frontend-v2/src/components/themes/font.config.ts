/**
 * CISNE Frontend V2 — hermetic build.
 *
 * The upstream template instantiated sixteen next/font/google loaders at
 * module-import time. They require external font downloads during builds and
 * caused non-deterministic Turbopack failures on identical commits.
 *
 * Existing theme CSS defines each font-family with fallback generic families.
 * Keep those declarations intact while avoiding network-only font imports.
 * Locally hosted, licensed font assets can be added in a separate UI batch.
 */
export const fontVariables = '';
