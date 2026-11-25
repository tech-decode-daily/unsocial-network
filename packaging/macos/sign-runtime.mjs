import { sign } from "@electron/osx-sign";

const [app, identity, keychain] = process.argv.slice(2);
if (!app || !identity) throw Error("Supply the Electron bundle and signing identity.");
const testBuild = identity === "-";
await sign({
  app, identity, keychain,
  platform: "darwin",
  identityValidation: !testBuild,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({
    hardenedRuntime: !testBuild,
    timestamp: testBuild ? "none" : undefined,
  }),
});
