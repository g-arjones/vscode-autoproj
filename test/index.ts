import * as path from 'path';
import Mocha = require('mocha');
import { install } from 'source-map-support';
import glob = require('glob');

export function run(): Promise<void> {
	// Source map support
	install();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'bdd',
        useColors: true
	});

	const testsRoot = path.resolve(__dirname, '.');

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: testsRoot }, (err: Error | null, files: string[]) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run((failures: number) => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}
