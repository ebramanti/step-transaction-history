import {
  ConfirmedSignatureInfo,
  Connection,
  ParsedConfirmedTransaction,
  ParsedInnerInstruction,
  ParsedInstruction,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";

export const SERUM_SWAP_PROGRAM_ID =
  "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8";
export const ORCA_SWAP_PROGRAM_ID =
  "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1";
export const PROGRAM_ID_SET = new Set([
  SERUM_SWAP_PROGRAM_ID,
  ORCA_SWAP_PROGRAM_ID,
]);

type TransactionFilterOptions = {
  before?: TransactionSignature;
  limit?: number;
  programIds?: Set<string>;
};

export type Platform = "Serum" | "Orca";
export type TransactionType = "Swap";

export type Transaction = {
  signature: TransactionSignature;
  platform: Platform;
  type: TransactionType;
  date?: Date | null;
};

export type Swap = Transaction & {
  fromSource: string;
  fromDestination: string;
  fromAmount: string;
  toSource: string;
  toDestination: string;
  toAmount: string;
};

export type ParsedInstructionInfo = {
  info: {
    amount: string;
    authority: string;
    destination: string;
    source: string;
  };
  type: string;
};

export interface ParsedInstructionWithInfo extends ParsedInstruction {
  parsed: ParsedInstructionInfo;
}

export interface SerumInnerInstructionData extends ParsedInnerInstruction {
  instructions: ParsedInstructionWithInfo[];
}

const chunkArray = <T>(array: Array<T>, n: number) =>
  Array.from({ length: Math.ceil(array.length / n) }, (_, i) =>
    array.slice(i * n, i * n + n)
  );

const INTERNAL_TRANSACTION_QUERY_LIMIT = 100;
const INTERNAL_TRANSACTION_PARTITION_SIZE =
  INTERNAL_TRANSACTION_QUERY_LIMIT / 2;
const BELOW_MINIMUM_LEDGER_SLOT_PARTITION_SIZE =
  INTERNAL_TRANSACTION_PARTITION_SIZE / 5;

export const getFilteredTransactions = async (
  connection: Connection,
  publicKey: PublicKey,
  options: TransactionFilterOptions = {}
): Promise<ParsedConfirmedTransaction[]> => {
  let filteredTransactions: ParsedConfirmedTransaction[] = [];
  const limit = options.limit || 20;
  let before = options?.before;
  let firstConfirmedSignaturesQueryLength = 0;

  const minimumLedgerSlot = await connection.getMinimumLedgerSlot();

  while (filteredTransactions.length < limit) {
    if (
      firstConfirmedSignaturesQueryLength > 0 &&
      firstConfirmedSignaturesQueryLength < INTERNAL_TRANSACTION_QUERY_LIMIT
    ) {
      break;
    }

    const confirmedSignatures = await connection.getConfirmedSignaturesForAddress2(
      publicKey,
      {
        before: before,
        limit: INTERNAL_TRANSACTION_QUERY_LIMIT,
      },
      "confirmed"
    );

    if (firstConfirmedSignaturesQueryLength === 0) {
      firstConfirmedSignaturesQueryLength = confirmedSignatures.length;
    }

    if (confirmedSignatures.length === 0) {
      break;
    }

    let successfulConfirmedSignatures = confirmedSignatures.filter(
      ({ err }) => err === null
    );
    let successfulConfirmedSignaturesPartitions = chunkArray(
      successfulConfirmedSignatures,
      INTERNAL_TRANSACTION_PARTITION_SIZE
    );
    let currentFilteredTransactions: ParsedConfirmedTransaction[] = [];
    for (const confirmedSignaturesPartition of successfulConfirmedSignaturesPartitions) {
      const aboveMinimumLedgerSlotSignatures: ConfirmedSignatureInfo[] = [];
      const belowMinimumLedgerSlotSignatures: ConfirmedSignatureInfo[] = [];

      for (const signature of confirmedSignaturesPartition) {
        if (signature.slot < minimumLedgerSlot) {
          belowMinimumLedgerSlotSignatures.push(signature);
        } else {
          aboveMinimumLedgerSlotSignatures.push(signature);
        }
      }
      const partitionedBelowMinimumLedgerSlotSignatures = chunkArray(
        belowMinimumLedgerSlotSignatures,
        BELOW_MINIMUM_LEDGER_SLOT_PARTITION_SIZE
      );

      let confirmedTransactionRequests: Promise<
        (ParsedConfirmedTransaction | null)[]
      >[] = [];
      if (aboveMinimumLedgerSlotSignatures.length > 0) {
        confirmedTransactionRequests.push(
          connection.getParsedConfirmedTransactions(
            aboveMinimumLedgerSlotSignatures.map(({ signature }) => signature),
            "confirmed"
          )
        );
      }

      if (partitionedBelowMinimumLedgerSlotSignatures.length > 0) {
        confirmedTransactionRequests = confirmedTransactionRequests.concat(
          partitionedBelowMinimumLedgerSlotSignatures.map((signatures) =>
            connection.getParsedConfirmedTransactions(
              signatures.map(({ signature }) => signature),
              "confirmed"
            )
          )
        );
      }

      const confirmedTransactions = (
        await Promise.all(confirmedTransactionRequests)
      ).flat();
      currentFilteredTransactions = currentFilteredTransactions.concat(
        confirmedTransactions.filter(
          (data): data is ParsedConfirmedTransaction => {
            if (!data) {
              return false;
            }

            if (options?.programIds) {
              return data.transaction.message.instructions.some((i) =>
                options.programIds!.has(i.programId.toBase58())
              );
            }

            return true;
          }
        )
      );
    }

    if (
      confirmedSignatures.length < INTERNAL_TRANSACTION_QUERY_LIMIT &&
      currentFilteredTransactions.length === 0
    ) {
      break;
    }

    filteredTransactions = filteredTransactions.concat(
      currentFilteredTransactions
    );
    before =
      filteredTransactions[filteredTransactions.length - 1].transaction
        .signatures[0];
  }
  return filteredTransactions.slice(0, limit);
};

const isSPLTokenTransfer = (instruction: ParsedInstructionWithInfo) =>
  instruction.program === "spl-token" && instruction.parsed.type === "transfer";

export const getSerumData = (transaction: ParsedConfirmedTransaction): Swap => {
  const innerInstructionsIndex = transaction.transaction.message.instructions.findIndex(
    (i) => i.programId.toBase58() === SERUM_SWAP_PROGRAM_ID
  );
  const innerInstructionsData = transaction.meta?.innerInstructions?.find(
    (i) => i.index === innerInstructionsIndex
  );
  if (innerInstructionsData) {
    const {
      instructions: innerInstructions,
    } = innerInstructionsData as SerumInnerInstructionData;
    const [
      { parsed: sendInstructionData },
      { parsed: receiveInstructionData },
    ] = innerInstructions.filter(isSPLTokenTransfer);
    return {
      signature: transaction.transaction.signatures[0],
      platform: "Serum",
      type: "Swap",
      date: transaction.blockTime
        ? new Date(transaction.blockTime * 1000)
        : null,
      fromSource: sendInstructionData.info.source,
      fromDestination: sendInstructionData.info.destination,
      fromAmount: sendInstructionData.info.amount,
      toSource: receiveInstructionData.info.source,
      toDestination: receiveInstructionData.info.destination,
      toAmount: receiveInstructionData.info.amount,
    };
  }
  throw new Error("Missing instruction data for Serum swap");
};

export const getOrcaData = (transaction: ParsedConfirmedTransaction): Swap => {
  const innerInstructions = transaction.meta?.innerInstructions ?? [];
  const transferInstructions = innerInstructions
    .flatMap((i) => i.instructions as ParsedInstructionWithInfo[])
    .filter(isSPLTokenTransfer);
  const firstTransferInstruction = transferInstructions[0];
  const lastTransferInstruction =
    transferInstructions[transferInstructions.length - 1];

  if (firstTransferInstruction) {
    const { parsed: sendInstructionData } = firstTransferInstruction;
    const { parsed: receiveInstructionData } = lastTransferInstruction;
    return {
      signature: transaction.transaction.signatures[0],
      platform: "Orca",
      type: "Swap",
      date: transaction.blockTime
        ? new Date(transaction.blockTime * 1000)
        : null,
      fromSource: sendInstructionData.info.source,
      fromDestination: sendInstructionData.info.destination,
      fromAmount: sendInstructionData.info.amount,
      toSource: receiveInstructionData.info.source,
      toDestination: receiveInstructionData.info.destination,
      toAmount: receiveInstructionData.info.amount,
    };
  }
  throw new Error("Missing instruction data for Orca swap");
};
