import { IOutputChannel } from "./interface";

export class ConsoleOutputChannel implements IOutputChannel {
    public appendLine(value: string) {
        // tslint:disable-next-line:no-console
        console.log(value);
    }
}
