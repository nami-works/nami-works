export function formatCustomerShort(
  name: string | null | undefined,
  guestFallback = "Guest",
): string {
  if (!name) return guestFallback;
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toLocaleUpperCase() +
        word.slice(1).toLocaleLowerCase(),
    );
  if (words.length === 0) return guestFallback;
  if (words.length === 1) return words[0]!;
  if (words.length === 2) return `${words[0]} ${words[1]}`;
  const first = words[0]!;
  const middleInitial = words[1]!.charAt(0).toLocaleUpperCase();
  const last = words[words.length - 1]!;
  return `${first} ${middleInitial} ${last}`;
}
