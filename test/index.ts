import * as path from 'path';
import * as Mocha from 'mocha';
import { install } from 'source-map-support';
import * as glob from 'glob';

export function run(): Promise<void> {
	// Source map support
	install();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'bdd',
        useColors: true,
	});

	const testsRoot = path.resolve(__dirname, '.');

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run(failures => {
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
