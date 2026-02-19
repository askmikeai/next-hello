declare module "imap-simple" {
  interface ImapConfig {
    imap: {
      user: string;
      password: string;
      host: string;
      port: number;
      tls: boolean;
      authTimeout?: number;
      tlsOptions?: { rejectUnauthorized?: boolean };
    };
  }

  interface FetchOptions {
    bodies: string[];
    markSeen?: boolean;
  }

  interface MessagePart {
    which: string;
    body: string | Buffer;
  }

  interface MessageAttributes {
    uid?: number;
    flags?: string[];
    date?: Date;
  }

  interface Message {
    parts: MessagePart[];
    attributes?: MessageAttributes;
  }

  interface Connection {
    openBox(mailboxName: string): Promise<void>;
    search(searchCriteria: unknown[], fetchOptions: FetchOptions): Promise<Message[]>;
    getBoxes(): Promise<Record<string, unknown>>;
    end(): Promise<void>;
  }

  export function connect(config: ImapConfig): Promise<Connection>;
}
