import * as path from "path";

import { runTests } from "vscode-test";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to the extension test runner script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname);

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        /* tslint:disable no-console */
        console.error(err);
        console.error("Failed to run tests");
        /* tslint:enable no-console */

        process.exit(1);
    }
}

main();
