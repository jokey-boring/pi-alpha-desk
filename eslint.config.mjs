import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // 参考树、打包产物与生成目录不参与 lint
  {
    ignores: [
      "ref-repos/**",
      "release/**",
      "dist/**",
      ".next/**",
      "bundled-skills/**",
      "scripts/tmp-md-test.mjs",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["lib/bundled-skills.js", "bin/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
