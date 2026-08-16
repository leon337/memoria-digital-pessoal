export async function getApiReadiness(baseUrl: string): Promise<'ready' | 'unavailable'> {
  try {
    const response = await fetch(`${baseUrl}/health/ready`);
    return response.ok ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
