import EventEmitter from "eventemitter3";
import { PublicKey, Transaction } from "@solana/web3.js";
import { WalletAdapter } from "../contexts/wallet";

// Example address I found to use for testing
const EXAMPLE_ADDRESS = "5te3JNS256J1rCP1Fh3tJ1tSrkT4mgFpf5buZsafk5pX"

export class PublicKeyWalletAdapter extends EventEmitter implements WalletAdapter {
  _publicAddress: string;
  _publicKey: PublicKey | null;
  _onProcess: boolean;
  constructor() {
    super();
    this._publicAddress = EXAMPLE_ADDRESS;
    this._publicKey = null;
    this._onProcess = false;
    this.connect = this.connect.bind(this);
  }

  get publicKey() {
    return this._publicKey;
  }

  async signTransaction(transaction: Transaction) {
    return Promise.reject("Mock wallet for visualization only")
  }

  connect() {
    this._publicKey = new PublicKey(this._publicAddress);
    if (this._onProcess) {
      return;
    }

    this._onProcess = true;
    this.emit("connect", this._publicKey);
    this._onProcess = false;
  }

  disconnect() {
    if (this._publicKey) {
      this._publicKey = null;
      this.emit("disconnect");
    }
  }
}
