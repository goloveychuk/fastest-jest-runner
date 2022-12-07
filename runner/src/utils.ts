export async function* splitByNewline(gen: AsyncGenerator<string>) {
  let soFar: string | undefined = undefined;

  for await (const data of gen) {
    const parts: string[] = ((soFar ?? '') + data).split('\n');
    soFar = parts.pop();

    for (const part of parts) {
      yield part;
    }
  }
}
