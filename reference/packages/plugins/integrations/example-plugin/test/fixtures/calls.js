import { exampleDeployment, manyRulesDeployment, network } from "./discovery.js";

export function discoveryCalls() {
  const config = exampleDeployment();
  const many = manyRulesDeployment(10_001);

  return [
    { config, cursor: undefined, pageSize: 2 },
    { config, cursor: "2", pageSize: 2 },
    { config: { network, rules: [] }, cursor: undefined, pageSize: 256 },
    {
      config: { ...config, network: { ...network, networkId: 1, networkMagic: 764824073 } },
      cursor: undefined,
      pageSize: 256,
    },
    { config: many, cursor: undefined, pageSize: 256 },
    { config: many, cursor: "9984", pageSize: 256 },
    { config, cursor: undefined, pageSize: 0 },
    { config, cursor: undefined, pageSize: 257 },
    { config, cursor: "01", pageSize: 256 },
    { config, cursor: "5", pageSize: 256 },
    {
      config: { network: { ...network, networkId: 2 }, rules: [] },
      cursor: undefined,
      pageSize: 256,
    },
  ];
}
