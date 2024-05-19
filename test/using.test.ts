import * as assert from "assert";
import { GlobalMock, Times } from "typemoq";
import { using } from "./using";
import { usingResultRegistry } from "./hooks";

namespace foo {
    export class Foo {
        public value: string = "foo";
        public get getter() { return "foo"; }
        public async someAsyncMethod() { return 13; }
    }

    export async function someAsyncFunction(): Promise<number> {
        return 13;
    }

    export const value = new Foo();
}

describe("using()", () => {
    it("overrides class definitions", () => {
        const m = GlobalMock.ofType(foo.Foo, foo);
        m.setup((x) => x.value).returns((x) => "bar");
        m.setup((x) => x.getter).returns((x) => "bar");

        using(m).do(() => {
            const f = new foo.Foo();
            assert.equal(f.value, "bar");
            assert.equal(f.getter, "bar");
        })

        const f = new foo.Foo();
        assert.equal(f.value, "foo");
        assert.equal(f.getter, "foo");
    });
    it("overrides builtin functions", () => {
        const m = GlobalMock.ofInstance(console.log, "log", console);
        using(m).do(() => {
            console.log("foo")
        })
        m.verify((x) => x("foo"), Times.once());
    });
    it("overrides values", () => {
        const m = GlobalMock.ofInstance(foo.value, "value", foo);
        m.setup((x) => x.value).returns((x) => "bar");
        m.setup((x) => x.getter).returns((x) => "bar");

        using(m).do(() => {
            assert.equal(foo.value.value, "bar");
            assert.equal(foo.value.getter, "bar");
        })
        assert.equal(foo.value.value, "foo");
        assert.equal(foo.value.getter, "foo");
    });
    it("overrides prototype's properties on the container", async () => {
        const f = new foo.Foo();
        const m = GlobalMock.ofInstance(f.someAsyncMethod, "someAsyncMethod", f);
        await using(m).do(async () => {
            await f.someAsyncMethod();
        });
        m.verify((x) => x(), Times.once());
    });
    it("handles async functions", async () => {
        const m = GlobalMock.ofType(foo.Foo, foo);
        const n = GlobalMock.ofInstance(console.log, "log", console);
        const o = GlobalMock.ofInstance(foo.someAsyncFunction, "someAsyncFunction", foo);

        m.setup((x) => x.someAsyncMethod()).returns((x) => Promise.resolve(21));
        o.setup((x) => x()).returns((x) => Promise.resolve(21));

        await using(m, n, o).do(async () => {
            const f = new foo.Foo();
            assert.equal(await f.someAsyncMethod(), 21);
            assert.equal(await foo.someAsyncFunction(), 21);
            console.log("foo");
        })
        n.verify((x) => x("foo"), Times.once());
    });
    it("auto removes result from registry", () => {
        const m = GlobalMock.ofType(foo.Foo, foo);
        using(m).do(() => {
            assert.equal(usingResultRegistry.length, 1);
        })
        assert.equal(usingResultRegistry.length, 0);

        const usingResult = using(m);
        assert.equal(usingResultRegistry.length, 1);
        usingResult.rollback();
        assert.equal(usingResultRegistry.length, 0);
    });
});
