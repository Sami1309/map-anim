// Re-export shared animation core so web and renderer use one source
export * from './shared/animation-core.js';
export { runAnimationSequencePreview as runAnimationSequence } from './shared/animation-core.js';
// (MapPreview imports runAnimationSequence; keep the name stable)

