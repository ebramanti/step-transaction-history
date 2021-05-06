import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { PublicKey } from "@solana/web3.js";
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

export const TransactionHistory: FC = () => {
  const { wallet } = useWallet();
  const publicKey = wallet?.publicKey;
  const connection = useConnection();
  const { tokenMap } = useConnectionConfig();

  const [swaps, setSwaps] = useState<Swap[]>([]);

  useEffect(() => {
    (async () => {
      if (publicKey) {
        const filteredTransactions = await getFilteredTransactions(
          connection,
          publicKey,
          {
            programIds: PROGRAM_ID_SET,
            limit: TRANSACTION_LIMIT,
          }
        );

        const swaps = filteredTransactions.map<Swap>((transaction) => {
          let data: Swap | undefined;
          // TODO: Rework getFilteredTransactions to capture transaction data source
          for (let instruction of transaction.transaction.message
            .instructions) {
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
        setSwaps(swaps);
        console.log(swaps);

        // TODO: Remove, using this to manually test before argument
        // @ts-ignore
        window.getFilteredTransactions = (before: string) =>
          getFilteredTransactions(connection, publicKey, {
            before: before,
            programIds: PROGRAM_ID_SET,
          });
      }
    })();
  }, [publicKey, connection]);

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
      dataSource={swaps}
      columns={columns}
      footer={() => {
        if (swaps.length > 0) {
          return (
            // TODO: Implement functionality for these buttons
            <div style={{ textAlign: "right" }}>
              <Button icon={<LeftOutlined />} />{" "}
              <Button icon={<RightOutlined />} />
            </div>
          );
        }
      }}
    />
  );
};
