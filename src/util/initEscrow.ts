import { AccountLayout, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Account, clusterApiUrl, Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
const bs58 = require('bs58');
import { ESCROW_ACCOUNT_DATA_LAYOUT, EscrowLayout } from "./layout";

const connection = new Connection("http://localhost:8899", 'singleGossip');

export const initEscrow = async (
    privateKey: string,
    initializerXTokenAccountPubkeyString: string,
    amountXTokensToSendToEscrow: number,
    initializerReceivingTokenAccountPubkeyString: string,
    expectedAmount: number,
    escrowProgramIdString: string) => {
    const initializerXTokenAccountPubkey = new PublicKey(initializerXTokenAccountPubkeyString);

    //@ts-expect-error
    const XTokenMintAccountPubkey = new PublicKey((await connection.getParsedAccountInfo(initializerXTokenAccountPubkey, 'singleGossip')).value!.data.parsed.info.mint);

    const privateKeyDecoded = bs58.decode(privateKey);
    const aliceAccount = new Account(privateKeyDecoded);

    const tempTokenAccount = new Account();
    const createTempTokenAccountIx = SystemProgram.createAccount({
        programId: TOKEN_PROGRAM_ID,
        space: AccountLayout.span,
        lamports: await connection.getMinimumBalanceForRentExemption(AccountLayout.span, 'singleGossip'),
        fromPubkey: aliceAccount.publicKey,
        newAccountPubkey: tempTokenAccount.publicKey
    });
    const initTempAccountIx = Token.createInitAccountInstruction(TOKEN_PROGRAM_ID, XTokenMintAccountPubkey, tempTokenAccount.publicKey, aliceAccount.publicKey);
    const transferXTokensToTempAccIx = Token
        .createTransferInstruction(TOKEN_PROGRAM_ID, initializerXTokenAccountPubkey, tempTokenAccount.publicKey, aliceAccount.publicKey, [], amountXTokensToSendToEscrow);
    
    const escrowAccount = new Account();
    const escrowProgramId = new PublicKey(escrowProgramIdString);

    const createEscrowAccountIx = SystemProgram.createAccount({
        space: ESCROW_ACCOUNT_DATA_LAYOUT.span,
        lamports: await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_DATA_LAYOUT.span, 'singleGossip'),
        fromPubkey: aliceAccount.publicKey,
        newAccountPubkey: escrowAccount.publicKey,
        programId: escrowProgramId
    });

    const initEscrowIx = new TransactionInstruction({
        programId: escrowProgramId,
        keys: [
            { pubkey: aliceAccount.publicKey, isSigner: true, isWritable: false },
            { pubkey: tempTokenAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: new PublicKey(initializerReceivingTokenAccountPubkeyString), isSigner: false, isWritable: false },
            { pubkey: escrowAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        data: Buffer.from(Uint8Array.of(0, ...new BN(expectedAmount).toArray("le", 8)))
    })

    const tx = new Transaction()
        .add(createTempTokenAccountIx, initTempAccountIx, transferXTokensToTempAccIx, createEscrowAccountIx, initEscrowIx);
    await connection.sendTransaction(tx, [aliceAccount, tempTokenAccount, escrowAccount]);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const encodedEscrowState = (await connection.getAccountInfo(escrowAccount.publicKey, 'singleGossip'))!.data;
    const decodedEscrowState = ESCROW_ACCOUNT_DATA_LAYOUT.decode(encodedEscrowState) as EscrowLayout;
    return {
        escrowAccountPubkey: escrowAccount.publicKey.toBase58(),
        isInitialized: !!decodedEscrowState.isInitialized,
        initializerAccountPubkey: new PublicKey(decodedEscrowState.initializerPubkey).toBase58(),
        XTokenTempAccountPubkey: new PublicKey(decodedEscrowState.initializerTempTokenAccountPubkey).toBase58(),
        initializerYTokenAccount: new PublicKey(decodedEscrowState.initializerReceivingTokenAccountPubkey).toBase58(),
        expectedAmount: new BN(decodedEscrowState.expectedAmount, 10, "le").toNumber()
    };
}