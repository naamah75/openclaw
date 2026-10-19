export function createPrivateContextCarrier<Identity extends object>() {
  const identities = new WeakMap<object, Identity>();
  return {
    carry<T extends object>(context: T, identity: Identity | undefined): T {
      if (!identity) {
        return context;
      }
      const carried = { ...context };
      identities.set(carried, identity);
      return carried;
    },
    read(context: object): Identity | undefined {
      return identities.get(context);
    },
  };
}
