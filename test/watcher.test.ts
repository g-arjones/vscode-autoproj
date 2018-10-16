import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as watcher from "../src/watcher";
import * as helpers from "./helpers";

async function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function throttle(func: () => void, before: number = 10, after: number = 20): Promise<void> {
    await sleep(before);
    func();
    await sleep(after);
}

describe("FileWatcher", () => {
    let root: string;
    let subject: watcher.FileWatcher;
    let fileName: string;
    let hits: number;
    let fileHit: string;
    beforeEach(async () => {
        root = helpers.init();
        fileName = helpers.mkfile("", "file");
        subject = new watcher.FileWatcher();
        hits = 0;
        await sleep(10);
        subject.startWatching(fileName, (file) => {
            hits++;
            fileHit = file;
        });
    });
    afterEach(() => {
        try {
            subject.stopWatching(fileName);
        } catch (err) {
            // no-op
        }
        helpers.clear();
    });
    describe("startWatching()", () => {
        it("notifies of file changes", async () => {
            await throttle(() => {
                fs.appendFileSync(fileName, "modified", "utf8");
            });
            assert.equal(hits, 1);
            assert.equal(fileHit, fileName);
        });
        it("notifies of file deletion", async () => {
            await throttle(() => {
                fs.unlinkSync(fileName);
            });
            assert.equal(hits, 1);
            assert.equal(fileHit, fileName);
        });
        it("notifies of file renames", async () => {
            await throttle(() => {
                fs.renameSync(fileName, path.join(root, "newname"));
                helpers.registerFile("newname");
            });
            assert.equal(hits, 1);
            assert.equal(fileHit, fileName);
        });
        it("notifies of file creation", async () => {
            const newFile = path.join(root, "newfile");
            subject.startWatching(newFile, (file) => {
                hits++;
                fileHit = file;
            });
            await throttle(() => {
                fs.writeFileSync(newFile, "data", "utf8");
                helpers.registerFile("newfile");
            });
            subject.stopWatching(newFile);
            assert.equal(hits, 1);
            assert.equal(fileHit, newFile);
        });
        it("returns false if file is already being watched", () => {
            assert(!subject.startWatching(fileName, () => void 0));
        });
        it("returns true when a new watcher is created", () => {
            const newFile = path.join(root, "newfile");
            assert(subject.startWatching(newFile, () => void 0));
            subject.stopWatching(newFile);
        });
        it("does not watch the same file twice", async () => {
            subject.startWatching(fileName, (file) => {
                hits++;
            });
            await throttle(() => {
                fs.appendFileSync(fileName, "data", "utf8");
            });
            assert.equal(hits, 1);
        });
        it("does not trigger the callback at a high frequency", async () => {
            await throttle(() => {
                fs.appendFileSync(fileName, "data", "utf8");
            });
            await throttle(() => {
                fs.appendFileSync(fileName, "data", "utf8");
            });
            assert.equal(hits, 1);
        });
    });
    describe("stopWatching()", () => {
        it("stops watching file", async () => {
            await throttle(() => {
                fs.appendFileSync(fileName, "modified", "utf8");
            });
            subject.stopWatching(fileName);
            await throttle(() => {
                fs.appendFileSync(fileName, "modified", "utf8");
            });
            assert.equal(hits, 1);
            assert(subject.startWatching(fileName, (file) => void 0));
        });
        it("throws if file is not being watched", () => {
            assert.throws(() => subject.stopWatching("/not/watched"));
        });
    });
    describe("dispose()", () => {
        it("stops watching all files", async () => {
            const newFile = path.join(root, "newfile");
            subject.startWatching(newFile, (file) => {
                hits++;
            });
            subject.dispose();
            await throttle(() => {
                fs.appendFileSync(fileName, "modified", "utf8");
                fs.writeFileSync(newFile, "data", "utf8");
                helpers.registerFile("newfile");
            });
            assert.equal(hits, 0);
        });
    });
});
