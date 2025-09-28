/**
 * This declaration file tells TypeScript that when we import a file ending in .html,
 * it should be treated as a module that exports a string.
 */
declare module '*.html' {
	const content: string;
	export default content;
}