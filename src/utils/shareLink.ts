/**
 * Generates a shareable deep link for a subscription.
 * Returns the universal link preferentially for sharing.
 */
export function getSubscriptionShareLink(subscriptionId: string): string {
  return `https://subtrackr.app/subscription/${encodeURIComponent(subscriptionId)}`;
}

export async function shareSubscriptionLink(
  subscriptionId: string,
  subscriptionName: string
): Promise<void> {
  const { Share } = await import('react-native');
  const url = getSubscriptionShareLink(subscriptionId);

  await Share.share({
    message: `Check out ${subscriptionName} on SubTrackr: ${url}`,
    url,
  });
}
