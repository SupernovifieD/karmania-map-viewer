/** For the tests of the layers: a shader as the material that draws has it, without the lines that are only for the material that picks. */
export const drawing = (source: string): string =>
  source.replace(
    /#ifdef PICK[\s\S]*?(?:#else([\s\S]*?))?#endif/g,
    (_all, otherwise?: string) => otherwise ?? '',
  );
