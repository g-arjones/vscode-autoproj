import { IGlobalMock } from "typemoq";
import { isAsyncFunction } from "util/types";
import { usingResultRegistry } from "./hooks";


export class UsingResult {
    public rollback: () => void;
    constructor(rollback: () => void) {
        this.rollback = () => {
            usingResultRegistry.splice(0, usingResultRegistry.length,
                ...usingResultRegistry.filter((item) => item !== this))
            rollback();
        }
    }

    public do(callback: () => Promise<void>): Promise<void>;
    public do(callback: () => void): void;
    public do(callback: () => Promise<void> | void): Promise<void> | void {
        if (isAsyncFunction(callback)) {
            return callback()!.finally(() => {
                this.rollback();
            });
        } else {
            try {
                return callback();
            } finally {
                this.rollback();
            }
        }
    }
};

export function using(...mocks: IGlobalMock<any>[]) {
    let initials: { mock: IGlobalMock<any>, backup: PropertyDescriptor }[] = [];
    const commit = () => {
        for (const mock of mocks) {
            const getOwnOrPrototypeProperty = (): PropertyDescriptor | undefined => {
                return Object.getOwnPropertyDescriptor(mock.container, mock.name) ||
                        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(mock.container), mock.name)
            }

            const prop = getOwnOrPrototypeProperty();
            if (prop) {
                const newProp = getOwnOrPrototypeProperty()!;
                switch (mock.type) {
                    case 0: // Class
                        // TODO: return a new mock every time with same interceptor as the one used
                        //       by mock passed in as arg to 'using' (to support different ctor arguments)
                        newProp.value = function () { return mock.object; }
                        break;
                    case 1: // Function
                        newProp.value = mock.object;
                        delete newProp.get;
                        delete newProp.set;
                        break;
                    case 2: // Value
                        newProp.value = mock.object;
                        break;
                    default:
                        throw new Error(`Unknown global type: ${mock.type}`);
                }
                initials.push({ mock: mock, backup: prop });
                Object.defineProperty(mock.container, mock.name, newProp);
            } else {
                throw new Error(`Could not find '${mock.name}' property`);
            }
        }
    };
    const rollback = () => {
        for (const initial of initials) {
            Object.defineProperty(initial.mock.container, initial.mock.name, initial.backup);
        }
    };
    commit();
    const usingResult = new UsingResult(rollback);
    usingResultRegistry.push(usingResult);
    return usingResult;
}