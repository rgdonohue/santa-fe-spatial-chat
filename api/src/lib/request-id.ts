const requestIds = new WeakMap<Request, string>();

export function setRequestId(request: Request, requestId: string): void {
  requestIds.set(request, requestId);
}

export function getRequestId(request: Request): string | undefined {
  return requestIds.get(request);
}
