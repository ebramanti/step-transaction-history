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

const getSwaps = async (
  connection: Connection,
  publicKey: PublicKey,
  before?: TransactionSignature
): Promise<Swap[]> => {
  const filteredTransactions = await getFilteredTransactions(
    connection,
    publicKey,
    {
      programIds: PROGRAM_ID_SET,
      limit: TRANSACTION_LIMIT,
      before: before,
    }
  );

  const swaps = filteredTransactions.map<Swap>((transaction) => {
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

    return {
      signature: data.signature,
      platform: data.platform,
      type: data.type,
      fromAmount: data.fromAmount,
      fromSource: data.fromSource,
      toSource: data.toSource,
      toAmount: data.toAmount,
    };
  });

  const sourceSet = new Set(
    swaps.flatMap((swap) => [swap.fromSource, swap.toSource])
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

  const [swaps, setSwaps] = useState<Swap[]>([]);
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

  const columns: ColumnsType<object> = [
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
      title: "Asset",
      key: "asset",
      render: (value: Swap) => {
        const { toSource, fromSource } = value;
        const fromSourceMintAddress: PublicKey | undefined = cache.get(
          fromSource
        )?.info?.mint;
        const toSourceMintAddress: PublicKey | undefined = cache.get(toSource)
          ?.info?.mint;
        if (fromSourceMintAddress && toSourceMintAddress) {
          const fromToken = tokenMap.get(fromSourceMintAddress.toBase58());
          const toToken = tokenMap.get(toSourceMintAddress.toBase58());
          return (
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              <PoolIcon
                mintA={fromSourceMintAddress.toBase58()}
                mintB={toSourceMintAddress.toBase58()}
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
      render: (value: Swap) => {
        const { toSource, fromSource, toAmount, fromAmount } = value;
        const fromSourceMintAddress: PublicKey | undefined = cache.get(
          fromSource
        )?.info?.mint;
        const toSourceMintAddress: PublicKey | undefined = cache.get(toSource)
          ?.info?.mint;
        if (fromSourceMintAddress && toSourceMintAddress) {
          const fromToken = tokenMap.get(fromSourceMintAddress.toBase58());
          const toToken = tokenMap.get(toSourceMintAddress.toBase58());
          if (fromToken && toToken) {
            const fromTokenAmount =
              parseFloat(fromAmount) * 10 ** -fromToken.decimals;
            const toTokenAmount =
              parseFloat(toAmount) * 10 ** -toToken.decimals;
            return `-${fromTokenAmount} / +${toTokenAmount}`;
          }
        } else {
          return null;
        }
      },
    },
  ];

  return (
    <Table
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
              <Button icon={<RightOutlined />} onClick={onPageNext} />
            </div>
          );
        }
      }}
    />
  );
};
