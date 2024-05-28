import * as assert from "assert";
import * as path from "path";
import * as cpptools from "vscode-cpptools";
import * as vscode from "vscode";
import { GlobalMock, IGlobalMock, IMock, Mock, MockBehavior, Times } from "typemoq";
import { replaceAll } from "../src/cmt/util";
import { IPackage, Workspaces } from "../src/autoproj";
import { CompilationDatabase } from "../src/compilationDatabase";
import { CppConfigurationProvider } from "../src/cpptools";
import { WorkspaceBuilder } from "./helpers";
import { using } from "./using";
import { fs } from "../src/cmt/pr";

function generateCompileCommands(root: string) {
    return replaceAll(JSON.stringify([
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/src",
            "command": "/usr/bin/c++ -DBOOST_ALL_NO_LIB -DBOOST_ATOMIC_DYN_LINK -DBOOST_REGEX_DYN_LINK -DBOOST_SYSTEM_DYN_LINK -DBOOST_THREAD_DYN_LINK -Dsample_driver_EXPORTS -I/home/jammy/dev/foo/src/drivers/sample_driver/include -isystem /home/jammy/dev/foo/install/drivers/drivers_base/include --coverage -g -std=gnu++11 -fPIC -o CMakeFiles/sample_driver.dir/driver.cpp.o -c /home/jammy/dev/foo/src/drivers/sample_driver/src/driver.cpp",
            "file": "/home/jammy/dev/foo/src/drivers/sample_driver/src/driver.cpp",
            "output": "src/CMakeFiles/sample_driver.dir/driver.cpp.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test",
            "command": "/usr/bin/c++ -DBOOST_ALL_NO_LIB -DBOOST_ATOMIC_DYN_LINK -DBOOST_REGEX_DYN_LINK -DBOOST_SYSTEM_DYN_LINK -DBOOST_THREAD_DYN_LINK -DTEST_DATA_DIR=\\\"/home/jammy/dev/foo/src/drivers/sample_driver/test/test_data\\\" -I/home/jammy/dev/foo/src/drivers/sample_driver/include -isystem /home/jammy/dev/foo/install/drivers/drivers_base/include -isystem /usr/src/googletest/googlemock/include -isystem /usr/src/googletest/googlemock -isystem /usr/src/googletest/googletest/include -isystem /usr/src/googletest/googletest --coverage -g -std=gnu++11 -DGTEST_HAS_PTHREAD=1 -o CMakeFiles/test_Driver.dir/test_main.cpp.o -c /home/jammy/dev/foo/src/drivers/sample_driver/test/test_main.cpp",
            "file": "/home/jammy/dev/foo/src/drivers/sample_driver/test/test_main.cpp",
            "output": "test/CMakeFiles/test_Driver.dir/test_main.cpp.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test",
            "command": "/usr/bin/c++ -DBOOST_ALL_NO_LIB -DBOOST_ATOMIC_DYN_LINK -DBOOST_REGEX_DYN_LINK -DBOOST_SYSTEM_DYN_LINK -DBOOST_THREAD_DYN_LINK -DTEST_DATA_DIR=\\\"/home/jammy/dev/foo/src/drivers/sample_driver/test/test_data\\\" -I/home/jammy/dev/foo/src/drivers/sample_driver/include -isystem /home/jammy/dev/foo/install/drivers/drivers_base/include -isystem /usr/src/googletest/googlemock/include -isystem /usr/src/googletest/googlemock -isystem /usr/src/googletest/googletest/include -isystem /usr/src/googletest/googletest --coverage -g -std=gnu++11 -DGTEST_HAS_PTHREAD=1 -o CMakeFiles/test_Driver.dir/test_Driver.cpp.o -c /home/jammy/dev/foo/src/drivers/sample_driver/test/test_Driver.cpp",
            "file": "/home/jammy/dev/foo/src/drivers/sample_driver/test/test_Driver.cpp",
            "output": "test/CMakeFiles/test_Driver.dir/test_Driver.cpp.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test/gtest/googlemock",
            "command": "/usr/bin/c++  -I/home/jammy/dev/foo/src/drivers/sample_driver/include -I/usr/src/googletest/googlemock/include -I/usr/src/googletest/googlemock -isystem /usr/src/googletest/googletest/include -isystem /usr/src/googletest/googletest --coverage -g -std=c++11 -Wall -Wshadow -Wno-error=dangling-else -DGTEST_HAS_PTHREAD=1 -fexceptions -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -DGTEST_HAS_PTHREAD=1 -o CMakeFiles/gmock.dir/src/gmock-all.cc.o -c /usr/src/googletest/googlemock/src/gmock-all.cc",
            "file": "/usr/src/googletest/googlemock/src/gmock-all.cc",
            "output": "test/gtest/googlemock/CMakeFiles/gmock.dir/src/gmock-all.cc.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test/gtest/googlemock",
            "command": "/usr/bin/c++  -I/home/jammy/dev/foo/src/drivers/sample_driver/include -isystem /usr/src/googletest/googlemock/include -isystem /usr/src/googletest/googlemock -isystem /usr/src/googletest/googletest/include -isystem /usr/src/googletest/googletest --coverage -g -std=c++11 -Wall -Wshadow -Wno-error=dangling-else -DGTEST_HAS_PTHREAD=1 -fexceptions -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -DGTEST_HAS_PTHREAD=1 -o CMakeFiles/gmock_main.dir/src/gmock_main.cc.o -c /usr/src/googletest/googlemock/src/gmock_main.cc",
            "file": "/usr/src/googletest/googlemock/src/gmock_main.cc",
            "output": "test/gtest/googlemock/CMakeFiles/gmock_main.dir/src/gmock_main.cc.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test/gtest/googletest",
            "command": "/usr/bin/c++  -I/home/jammy/dev/foo/src/drivers/sample_driver/include -I/usr/src/googletest/googletest/include -I/usr/src/googletest/googletest --coverage -g -std=c++11 -Wall -Wshadow -Wno-error=dangling-else -DGTEST_HAS_PTHREAD=1 -fexceptions -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -o CMakeFiles/gtest.dir/src/gtest-all.cc.o -c /usr/src/googletest/googletest/src/gtest-all.cc",
            "file": "/usr/src/googletest/googletest/src/gtest-all.cc",
            "output": "test/gtest/googletest/CMakeFiles/gtest.dir/src/gtest-all.cc.o"
        },
        {
            "directory": "/home/jammy/dev/foo/build/sample_driver/test/gtest/googletest",
            "command": "/usr/bin/c++  -I/home/jammy/dev/foo/src/drivers/sample_driver/include -isystem /usr/src/googletest/googletest/include -isystem /usr/src/googletest/googletest --coverage -g -std=c++11 -Wall -Wshadow -Wno-error=dangling-else -DGTEST_HAS_PTHREAD=1 -fexceptions -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -DGTEST_HAS_PTHREAD=1 -o CMakeFiles/gtest_main.dir/src/gtest_main.cc.o -c /usr/src/googletest/googletest/src/gtest_main.cc",
            "file": "/usr/src/googletest/googletest/src/gtest_main.cc",
            "output": "test/gtest/googletest/CMakeFiles/gtest_main.dir/src/gtest_main.cc.o"
        }
    ]), "/home/jammy/dev/foo", root);
}

describe("CppConfigurationProvider", () => {
    let mockGetCppToolsApi: IGlobalMock<typeof cpptools.getCppToolsApi>;
    let subject: CppConfigurationProvider;
    let workspaces: Workspaces;
    beforeEach(async () => {
        mockGetCppToolsApi = GlobalMock.ofInstance(cpptools.getCppToolsApi, "getCppToolsApi", cpptools);
        workspaces = new Workspaces();
        subject = new CppConfigurationProvider(workspaces);
    });
    afterEach(() => {
        subject.dispose();
    });
    describe("an environment without the ms-vscode.cpptools extension", () => {
        describe("register()", () => {
            it("returns false if cpptools is not available", async () => {
                await using(mockGetCppToolsApi).do(async () => {
                    assert.equal(await subject.register(), false);
                });
            });
        });
        describe("clearDbs()", () => {
            it("disposes of all compilation dbs", () => {
                const mockDb1 = Mock.ofType<CompilationDatabase>();
                const mockDb2 = Mock.ofType<CompilationDatabase>();

                subject["_pathToCompilationDb"].set("/path/one", mockDb1.object);
                subject["_pathToCompilationDb"].set("/path/two", mockDb2.object);
                subject.clearDbs();
                mockDb1.verify((x) => x.dispose(), Times.once());
                mockDb2.verify((x) => x.dispose(), Times.once());
                assert.equal(subject["_pathToCompilationDb"].size, 0);
            });
        });
        describe("notifyChanges()", () => {
            it("does nothing", () => {
                subject.notifyChanges();
            });
        });
        describe("dispose()", () => {
            it("dispoes of all compilation dbs", () => {
                const mockDb1 = Mock.ofType<CompilationDatabase>();
                const mockDb2 = Mock.ofType<CompilationDatabase>();

                subject["_pathToCompilationDb"].set("/path/one", mockDb1.object);
                subject["_pathToCompilationDb"].set("/path/two", mockDb2.object);
                subject.dispose();
                mockDb1.verify((x) => x.dispose(), Times.once());
                mockDb2.verify((x) => x.dispose(), Times.once());
                assert.equal(subject["_pathToCompilationDb"].size, 0);
            });
        });
    });
    describe("an environment with the ms-vscode.cpptools extension", () => {
        let mockCppToolsApi: IMock<cpptools.CppToolsApi>;
        beforeEach(() => {
            mockCppToolsApi = Mock.ofType<cpptools.CppToolsApi>();
            mockCppToolsApi.setup((x: any) => x.then).returns(() => undefined);

            const cppToolsApiObject = Promise.resolve(mockCppToolsApi.object)
            mockGetCppToolsApi.setup((x) => x(cpptools.Version.v6)).returns((x) => cppToolsApiObject);
        });
        describe("register()", () => {
            it("registers if cpptools is available", async () => {
                await using(mockGetCppToolsApi).do(async () => {
                    assert.equal(await subject.register(), true);
                });

                mockCppToolsApi.verify((x) => x.registerCustomConfigurationProvider(subject), Times.once());
                mockCppToolsApi.verify((x) => x.notifyReady(subject), Times.atLeastOnce()); // TODO: it's being twice?
            });
            it("does not call notifyReady on an old API", async () => {
                mockCppToolsApi.setup((x) => x.notifyReady).returns((x) => (undefined as unknown) as () => void);

                await using(mockGetCppToolsApi).do(async () => {
                    assert.equal(await subject.register(), true);
                });

                mockCppToolsApi.verify((x) => x.registerCustomConfigurationProvider(subject), Times.once());
                mockCppToolsApi.verify((x) => x.didChangeCustomConfiguration(subject), Times.once());
                mockCppToolsApi.verify((x) => x.notifyReady(subject), Times.never());
            });
        });
        describe("when registered as a cpp configuration provider", () => {
            beforeEach(async () => {
                await using(mockGetCppToolsApi).do(async () => await subject.register());
            });
            describe("notifyChanges()", () => {
                it("notifies cpptools api of changes", () => {
                    subject.notifyChanges();
                    mockCppToolsApi.verify((x) => x.didChangeCustomBrowseConfiguration(subject), Times.once());
                    mockCppToolsApi.verify((x) => x.didChangeCustomConfiguration(subject), Times.once());
                });
            });
            describe("dispose()", () => {
                it("disposes of the cpptools api", () => {
                    subject.dispose();
                    mockCppToolsApi.verify((x) => x.dispose(), Times.once());
                });
            });
            describe("canProvideConfiguration()", () => {
                it("always returns true", async () => {
                    const file = vscode.Uri.file("/path/to/file");
                    assert.equal(await subject.canProvideConfiguration(file), true)
                });
            });
            describe("canProvideBrowseConfiguration()", () => {
                it("always returns false", async () => {
                    assert.equal(await subject.canProvideBrowseConfiguration(), false);
                });
            });
            describe("provideBrowseConfiguration()", () => {
                it("always returns null", async () => {
                    assert.equal(await subject.provideBrowseConfiguration(), null);
                });
            });
            describe("canProvideBrowseConfigurationsPerFolder()", () => {
                it("always returns false", async () => {
                    assert.equal(await subject.canProvideBrowseConfigurationsPerFolder(), false);
                });
            });
            describe("provideBrowseConfigurationsPerFolder()", () => {
                it("always returns null", async () => {
                    const file = vscode.Uri.file("/path/to/file");
                    assert.equal(await subject.provideFolderBrowseConfiguration(file), null);
                });
            });
            describe("provideConfigurations()", () => {
                it("returns an empty array if workspace is empty", async () => {
                    new WorkspaceBuilder().writeManifest();
                    assert.equal(await subject.provideConfigurations([vscode.Uri.file("/path/to/file.cpp")]), 0);
                });
            });
            describe("in a workspace with a cmake package", () => {
                let pkg: IPackage;
                let files: vscode.Uri[];
                let builder: WorkspaceBuilder;
                let compileCommandsPath: string[];
                beforeEach(() => {
                    builder = new WorkspaceBuilder();
                    pkg = builder.addPackage("sample_driver", "drivers");
                    files = [
                        vscode.Uri.file(path.join(pkg.srcdir, "src", "driver.cpp")),
                        vscode.Uri.file(path.join(pkg.srcdir, "test", "test_Driver.cpp")),
                        vscode.Uri.file(path.join(pkg.srcdir, "test", "test_main.cpp")),
                    ]

                    compileCommandsPath = [...builder.packageBuildDir("sample_driver"), "compile_commands.json"];
                    builder.fs.mkfile(generateCompileCommands(builder.root), ...compileCommandsPath);
                    workspaces.addFolder(pkg.srcdir);
                });
                it("gets notified when a db changes", async () => {
                    const joinedPath = path.join(pkg.builddir, "compile_commands.json");
                    const originalInterval = CompilationDatabase.POLLING_INTERVAL;
                    CompilationDatabase.POLLING_INTERVAL = 10;

                    try {
                        subject.dispose();
                        subject = new CppConfigurationProvider(workspaces);

                        const mock = GlobalMock.ofInstance(subject.notifyChanges, "notifyChanges", subject);
                        const event = new Promise<void>((resolve) => {
                            mock.setup((x) => x()).callback(() => resolve())
                        });
                        Promise.race

                        await subject.getCompilationDb(joinedPath);
                        await new Promise((r) => setTimeout(r, 20));
                        await using(mock).do(async () => {
                            await fs.writeFile(joinedPath, "{}");
                            await event;
                        });
                    } finally {
                        CompilationDatabase.POLLING_INTERVAL = originalInterval;
                    }
                });
                describe("getCompilationDb()", () => {
                    it("does not create a new db instance if one already exists", async () => {
                        const joinedPath = path.join(pkg.builddir, "compile_commands.json");
                        const db = await subject.getCompilationDb(joinedPath);
                        assert.equal(db, await subject.getCompilationDb(joinedPath));
                    });
                    it("does not load the db twice", async () => {
                        const joinedPath = path.join(pkg.builddir, "compile_commands.json");
                        const db = await subject.getCompilationDb(joinedPath);
                        const mock = GlobalMock.ofInstance(db.load, "load", db);

                        await using(mock).do(async () => {
                            await subject.getCompilationDb(joinedPath);
                        });

                        mock.verify((x) => x(), Times.never());
                    });
                    it("does not try to load a db that does not exist on disk", async () => {
                        const db = await subject.getCompilationDb("/does/not/exist.json");
                        const mock = GlobalMock.ofInstance(db.load, "load", db);

                        await using(mock).do(async () => {
                            await subject.getCompilationDb("/does/not/exist.json");
                        });

                        mock.verify((x) => x(), Times.never());
                    });
                    it("loads a db that was created after the first call", async () => {
                        const joinedPath = path.join(pkg.builddir, "compile_commands.json");
                        await fs.unlink(joinedPath);
                        const db = await subject.getCompilationDb(joinedPath);

                        builder.fs.mkfile(generateCompileCommands(builder.root), ...compileCommandsPath);
                        const mock = GlobalMock.ofInstance(db.load, "load", db);

                        await using(mock).do(async () => {
                            await subject.getCompilationDb(joinedPath);
                        });

                        mock.verify((x) => x(), Times.once());
                    });
                });
                describe("provideConfigurations()", () => {
                    it("handles missing file in the compilation db", async () => {
                        files.push(vscode.Uri.file(path.join(pkg.srcdir, "src", "main.cpp")))
                        const configItems = await subject.provideConfigurations(files)
                        assert.equal(configItems.length, files.length - 1);
                    });
                    it("returns the source file configuration items", async () => {
                        mockCppToolsApi.setup((x) => x.getVersion()).returns((x) => cpptools.Version.v2);
                        const configItems = await subject.provideConfigurations(files)

                        assert.equal(configItems.length, files.length);
                        assert.equal(configItems[0].uri, files[0]);
                        assert.deepEqual(configItems[0].configuration, {
                            compilerFragments: [
                                "-DBOOST_ALL_NO_LIB",
                                "-DBOOST_ATOMIC_DYN_LINK",
                                "-DBOOST_REGEX_DYN_LINK",
                                "-DBOOST_SYSTEM_DYN_LINK",
                                "-DBOOST_THREAD_DYN_LINK",
                                "-Dsample_driver_EXPORTS",
                                `-I${builder.root}/src/drivers/sample_driver/include`,
                                "-isystem",
                                `${builder.root}/install/drivers/drivers_base/include`,
                                "--coverage",
                                "-g",
                                "-std=gnu++11",
                                "-fPIC",
                                "-o",
                                "CMakeFiles/sample_driver.dir/driver.cpp.o",
                                "-c",
                                `${builder.root}/src/drivers/sample_driver/src/driver.cpp`,
                            ],
                            compilerPath: "/usr/bin/c++",
                            defines: [],
                            includePath: [],
                            intelliSenseMode: "gcc-x64",
                            standard: "c++11"
                        });
                    });
                });
            });
        });
    });
});