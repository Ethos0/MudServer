import "reflect-metadata";

import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as net from "net";
import { Connection, createConnection } from "typeorm";
import { User } from "./src/entity/User";

class Client {
  public user: User;
  get id() { return this._id; }

  private _address: string;
  get address() { return this._address; }

  private _events: EventEmitter = new EventEmitter();
  get events() { return this._events; }

  constructor(
    private _socket: net.Socket,
    private _id: number,
  ) {
    this._address = _socket.remoteAddress || "";

    _socket.on("data", (data) => (this.onData(data)));

    _socket.on("end", () => {
      console.log("Client disconnected:", this.id);
    });

    _socket.on("error", () => {
      console.log("Client error:", this.id);
    });

    _socket.on("timeout", () => {
      console.log("Client timed out:", this.id);
    });
  }

  public getLine() {
    return new Promise<string>((accept, reject) => {
      this._events.once("message", (message) => accept(message));
    });
  }

  public print(message: string) {
    message = message.replace(/\n/gm, "\r\n");
    this._socket.write(message + "\r\n");
  }

  public showPrompt() {
    this._socket.write("> ");
  }

  public async showMenu(options: Array<{ value: string, userString: string }>) {
    let optionIndex = 1;
    this.print("Select One:");
    for (const option of options) {
      this.print(`${optionIndex}) ${option.userString}`);
      optionIndex++;
    }

    let inputGood;
    let index: number = 0;
    do {
      inputGood = true;
      this.showPrompt();
      const input = await this.getLine();

      try {
        if (!input.match(/^\s*\d+\s*$/)) {
          throw new Error();
        }

        index = parseInt(input, 10);

        if (isNaN(index)) {
          throw new Error();
        }

        if (index < 1 || index > options.length) {
          throw new Error();
        }
      } catch (e) {
        inputGood = false;
        this.print("Please choose a valid option");
      }
    } while (!inputGood);

    return options[index - 1].value;
  }

  private onData(data: Buffer) {
    const message = data.toString().replace(/(\r\n|\n|\r)/gm, "");
    this._events.emit("message", message);
    console.log(`Client ${this._id} received:`, message);
  }
}

class Server {
  private server: net.Server;
  private clients: {[id: number]: Client} = {};
  private nextId: number = 0;
  constructor(private db: Connection) {
    this.server = net.createServer((socket) => this.onConnection(socket));
  }

  public listen(port: number) {
    this.server.listen(port);
  }

  public close() {
    this.server.close();
  }

  private async onConnection(socket: net.Socket) {
    const client = new Client(socket, this.nextId);
    this.clients[this.nextId] = client;
    this.nextId++;

    console.log("Client connected:", client.id);
    client.print(`Welcome to the Telnet server! Your id is ${client.id}`);

    // Login flow
    let gotoNext = false;
    while (!gotoNext) {
      const choice = await client.showMenu([
        {value: "login", userString: "Login"},
        {value: "create-user", userString: "Create User"},
        {value: "reset-password", userString: "Reset Password"},
      ]);

      if (choice === "login") {
        await this.doLogin(client);

        if (client.user !== undefined) {
          gotoNext = true;
        }
      } else if (choice === "create-user" ) {
        await this.doRegister(client);
      }
    }

    // Main game
    gotoNext = false;
    while (!gotoNext) {
      client.showPrompt();
      const input = await client.getLine();

      console.log(input);
    }
  }

  private async doLogin(client: Client) {
    client.print("Username:");
    client.showPrompt();
    const username = await client.getLine();

    client.print("Password:");
    client.showPrompt();
    const password = await client.getLine();

    const user = await this.db.getRepository(User).findOne({ username });

    if (user === undefined) {
      client.print("No user by that username");
      return;
    }

    const hash = crypto.createHash("sha256").update(password).digest("base64");
    if (hash !== user.passwordHash) {
      client.print("Incorrect password");
      return;
    }

    client.print(`Welcome ${user.username}!`);
    console.log("Logged in:", user);
    client.user = user;
  }

  private async doRegister(client: Client) {
    client.print("Username:");
    client.showPrompt();
    const username = await client.getLine();

    client.print("Password:");
    client.showPrompt();
    const password = await client.getLine();

    let user = await this.db.getRepository(User).findOne({ username });

    if (user !== undefined) {
      client.print("A user already exists with that user name");
      return;
    }

    user = new User();
    user.username = username;
    user.passwordHash = crypto.createHash("sha256").update(password).digest("base64");
    await this.db.manager.save(user);
  }
}

async function bootstrap() {
  const db = await createConnection();
  const server = new Server(db);

  const shutdownFunc = () => {
    server.close();
    db.close();
  };

  process.on("SIGINT", () => shutdownFunc());
  process.on("SIGTERM", () => shutdownFunc());

  server.listen(8023);
}

bootstrap();
