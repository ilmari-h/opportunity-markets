// Empty fs shim for browser - @arcium-hq/client imports fs but we never use loadFromFile()
export const readFileSync = () => {
  throw new Error('fs.readFileSync is not available in browser');
};
export default { readFileSync };
