// .vscode-test.mjs
import { defineConfig } from '@vscode/test-cli';

export default defineConfig(
    {
        tests: [
            {
                files: 'out/test/**/*.test.js',
                workspaceFolder: `.test-workspace/test-workspace.code-workspace`,
                skipExtensionDependencies: true,
                launchArgs: [
                    "--disable-extensions",
                    '--no-sandbox', // https://github.com/microsoft/vscode-test/issues/221
                    '--disable-gpu',
                    '--disable-updates',
                    '--skip-welcome',
                    '--skip-release-notes',
                    '--disable-workspace-trust'
                ],
                mocha: {
                    require: ["./out/test/sourceMap.js"],
                    timeout: 2000,
                    ui: 'bdd'
                }
            }
        ],
        coverage: {
            exclude: ['**/out/test/**'],
            reporter: ['html', 'lcov', 'text-summary']
        }
    }
);
