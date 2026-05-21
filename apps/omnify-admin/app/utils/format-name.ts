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
  const first = words[0]!;
  const lastInitial = words[words.length - 1]!.charAt(0).toLocaleUpperCase();
  return `${first} ${lastInitial}`;
}
