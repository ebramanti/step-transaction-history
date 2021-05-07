import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Connection, PublicKey, TransactionSignature } from "@solana/web3.js";
import { Button, Table } from "antd";
import { ColumnsType } from "antd/lib/table";
import React, { FC, useEffect, useState } from "react";
import {
  cache,
  getMultipleAccounts,
  TokenAccountParser,
} from "../../contexts/accounts";
import { useConnection, useConnectionConfig } from "../../contexts/connection";
import { useWallet } from "../../contexts/wallet";
import {
  getFilteredTransactions,
  getOrcaData,
  getSerumData,
  ORCA_SWAP_PROGRAM_ID,
  PROGRAM_ID_SET,
  SERUM_SWAP_PROGRAM_ID,
  Swap,
} from "../../transactionHistory";
import { PoolIcon } from "../TokenIcon";

const TRANSACTION_LIMIT = 20;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
});

type SwapRow = Swap & { key: string };

type MintAddresses = {
  fromMintAddress?: PublicKey;
  toMintAddress?: PublicKey;
};

const getAccountFromCache = (pubKey: string): PublicKey | undefined =>
  cache.get(pubKey)?.info?.mint;

const getMintAddresses = ({
  fromSource,
  fromDestination,
  toSource,
  toDestination,
}: Swap): MintAddresses => {
  const fromSourceMintAddress = getAccountFromCache(fromSource);
  const fromDestinationMintAddress = getAccountFromCache(fromDestination);
  const toSourceMintAddress = getAccountFromCache(toSource);
  const toDestinationMintAddress = getAccountFromCache(toDestination);

  return {
    fromMintAddress: fromSourceMintAddress ?? fromDestinationMintAddress,
    toMintAddress: toSourceMintAddress ?? toDestinationMintAddress,
  };
};

const getSwaps = async (
  connection: Connection,
  publicKey: PublicKey,
  before?: TransactionSignature
): Promise<SwapRow[]> => {
  const filteredTransactions = await getFilteredTransactions(
    connection,
    publicKey,
    {
      programIds: PROGRAM_ID_SET,
      limit: TRANSACTION_LIMIT,
      before: before,
    }
  );

  const swaps = filteredTransactions.map<SwapRow>((transaction) => {
    let data: Swap | undefined;
    // TODO: Rework getFilteredTransactions to capture transaction data source
    for (let instruction of transaction.transaction.message.instructions) {
      const rawProgramId = instruction.programId.toBase58();
      if (rawProgramId === SERUM_SWAP_PROGRAM_ID) {
        data = getSerumData(transaction);
        break;
      }

      if (rawProgramId === ORCA_SWAP_PROGRAM_ID) {
        data = getOrcaData(transaction);
        break;
      }
    }

    if (!data) {
      throw new Error("Unable to parse transaction data");
    }

    return { ...data, key: data.signature };
  });

  const sourceSet = new Set(
    swaps.flatMap((swap) => [
      swap.fromSource,
      swap.fromDestination,
      swap.toSource,
      swap.toDestination,
    ])
  );

  const accounts = await getMultipleAccounts(
    connection,
    Array.from(sourceSet),
    "confirmed"
  );
  accounts.keys.forEach((key, index) => {
    const account = accounts.array[index];
    if (account) {
      cache.add(new PublicKey(key), account, TokenAccountParser);
    }
  });
  return swaps;
};

export const TransactionHistory: FC = () => {
  const { wallet } = useWallet();
  const publicKey = wallet?.publicKey;
  const connection = useConnection();
  const { tokenMap } = useConnectionConfig();

  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (publicKey) {
      setLoading(true);
      getSwaps(connection, publicKey).then((swaps) => {
        setSwaps(swaps);
        setOffset(0);
        setLoading(false);
      });
    }
  }, [publicKey, connection]);

  const onPagePrevious = () => {
    setOffset((previousOffset) => previousOffset - TRANSACTION_LIMIT);
  };

  const onPageNext = () => {
    const updatedOffset = offset + TRANSACTION_LIMIT;
    const lastElementInPreviousOffset = updatedOffset - 1;

    if (
      swaps.slice(updatedOffset, updatedOffset + TRANSACTION_LIMIT).length ===
      TRANSACTION_LIMIT
    ) {
      return setOffset(updatedOffset);
    }

    if (publicKey) {
      setLoading(true);
      getSwaps(
        connection,
        publicKey,
        swaps[lastElementInPreviousOffset].signature
      ).then((swaps) => {
        setSwaps((currentSwaps) => {
          setOffset(updatedOffset);
          const updatedSwaps = currentSwaps.concat(swaps);
          return updatedSwaps;
        });
        setLoading(false);
      });
    }
  };

  const columns: ColumnsType<SwapRow> = [
    {
      title: "Platform",
      dataIndex: "platform",
      key: "platform",
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      render: (_, record) => {
        let dateString = "Unknown";
        if (record.date) {
          dateString = DATE_FORMATTER.format(record.date);
        }

        return (
          <a
            rel="noopener noreferrer"
            target="_blank"
            href={`https://www.solanabeach.io/transaction/${record.signature}`}
          >
            {dateString}
          </a>
        );
      },
    },
    {
      title: "Asset",
      key: "asset",
      render: (_, record) => {
        const { fromMintAddress, toMintAddress } = getMintAddresses(record);
        if (fromMintAddress && toMintAddress) {
          const fromToken = tokenMap.get(fromMintAddress.toBase58());
          const toToken = tokenMap.get(toMintAddress.toBase58());
          return (
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              <PoolIcon
                mintA={fromMintAddress.toBase58()}
                mintB={toMintAddress.toBase58()}
              />
              {fromToken?.symbol} - {toToken?.symbol}
            </div>
          );
        } else {
          return null;
        }
      },
    },
    {
      title: "Amount",
      key: "amount",
      render: (_, record) => {
        const { toAmount, fromAmount } = record;
        const { fromMintAddress, toMintAddress } = getMintAddresses(record);
        if (fromMintAddress && toMintAddress) {
          const fromToken = tokenMap.get(fromMintAddress.toBase58());
          const toToken = tokenMap.get(toMintAddress.toBase58());
          if (fromToken && toToken) {
            const fromTokenAmount =
              parseFloat(fromAmount) * 10 ** -fromToken.decimals;
            const toTokenAmount =
              parseFloat(toAmount) * 10 ** -toToken.decimals;
            return (
              <>
                <span
                  style={{ color: "#80330f" }}
                >{`-${fromTokenAmount}`}</span>
                {" / "}
                <span style={{ color: "#148f6d" }}>{`+${toTokenAmount}`}</span>
              </>
            );
          }
        } else {
          return null;
        }
      },
    },
  ];

  return (
    <Table<SwapRow>
      dataSource={swaps.slice(offset, offset + TRANSACTION_LIMIT)}
      columns={columns}
      pagination={false}
      loading={loading}
      footer={() => {
        if (swaps.length > 0) {
          return (
            <div style={{ textAlign: "right" }}>
              <Button
                icon={<LeftOutlined />}
                disabled={offset === 0}
                onClick={onPagePrevious}
              />{" "}
              <Button
                icon={<RightOutlined />}
                onClick={onPageNext}
                disabled={offset === 0 && swaps.length < TRANSACTION_LIMIT}
              />
            </div>
          );
        }
      }}
    />
  );
};
