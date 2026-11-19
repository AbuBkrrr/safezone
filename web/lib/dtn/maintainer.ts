// Built-in maintainer trust. Packs and keyrings are accepted only from keys this device trusts.
// Keyring rotation replaces this set on the device (signed by a key already trusted).
// The secret keys are kept offline by the maintainer and never stored in this repository.
export const MAINTAINER_PUB = "4e203ec98eedfbd9251f35a817d66ddbd6acf5d6579e7a5db6be06d54ea96a1d";
export const BUILTIN_TRUSTED: string[] = [MAINTAINER_PUB];
