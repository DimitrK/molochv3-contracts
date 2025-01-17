import {
  BankExtension,
  NewBalance,
  Withdraw,
} from "../generated/templates/BankExtension/BankExtension";
import { Member, TributeDao, Token, TokenBalance } from "../generated/schema";
import { GUILD, LOOT, SHARES, TOTAL } from "./helpers/constants";
import { Address, BigInt, log } from "@graphprotocol/graph-ts";

function internalTransfer(
  createdAt: string,
  extensionAddress: Address,
  memberAddress: Address,
  tokenAddress: Address
): void {
  // get bank extension bindings
  let registry = BankExtension.bind(extensionAddress);
  let daoAddress = registry.dao();

  let tributedaos: string[] = [];

  if (
    TOTAL.toHex() != memberAddress.toHex() &&
    GUILD.toHex() != memberAddress.toHex()
  ) {
    let membertokenBalanceId = daoAddress
      .toHex()
      .concat("-tokenbalances-")
      .concat(memberAddress.toHex());

    let member = Member.load(memberAddress.toHex());
    let token = Token.load(tokenAddress.toHex());
    let tokenBalance = TokenBalance.load(membertokenBalanceId);

    if (member == null) {
      member = new Member(memberAddress.toHex());
      member.createdAt = createdAt;
      member.memberAddress = memberAddress;
      member.delegateKey = memberAddress;
      member.isDelegated = false;
    } else {
      // get members daos
      tributedaos = member.tributedaos;
    }

    // create 1-1 relationship between member and dao
    tributedaos.push(daoAddress.toHexString());
    // add members daos
    member.tributedaos = tributedaos;

    if (token == null) {
      token = new Token(tokenAddress.toHex());
      token.tokenAddress = tokenAddress;
    }

    if (tokenBalance == null) {
      tokenBalance = new TokenBalance(membertokenBalanceId);
      // we give it an initial 0 balance
      tokenBalance.tokenBalance = BigInt.fromI32(0);
    }

    /**
     * get `balanceOf` for members SHARES, and LOOT
     */

    // get balanceOf member shares
    let balanceOfSHARES = registry.balanceOf(memberAddress, SHARES);
    member.shares = balanceOfSHARES;

    // get balanceOf member loot
    let balanceOfLOOT = registry.balanceOf(memberAddress, LOOT);
    member.loot = balanceOfLOOT;

    // omit the `TOTAL` & `GUILD` addresses from the ragequit check
    if (
      TOTAL.toHex() != memberAddress.toHex() &&
      GUILD.toHex() != memberAddress.toHex()
    ) {
      let didFullyRagequit =
        balanceOfSHARES.equals(BigInt.fromI32(0)) &&
        balanceOfLOOT.equals(BigInt.fromI32(0));

      // fully raged quit
      member.didFullyRagequit = didFullyRagequit;
    }

    tokenBalance.token = tokenAddress.toHex();
    tokenBalance.member = memberAddress.toHex();

    tokenBalance.tokenBalance = balanceOfSHARES.plus(balanceOfLOOT);

    member.save();
    token.save();
    tokenBalance.save();
  }

  // get totalShares in the dao
  let balanceOfTotalShares = registry.balanceOf(TOTAL, SHARES);
  let dao = TributeDao.load(daoAddress.toHexString());

  if (dao != null) {
    dao.totalShares = balanceOfTotalShares.toString();

    dao.save();
  }
}

export function handleNewBalance(event: NewBalance): void {
  log.info(
    "================ NewBalance event fired. member {}, tokenAddr {}, amount {}",
    [
      event.params.member.toHexString(),
      event.params.tokenAddr.toHexString(),
      event.params.amount.toString(),
    ]
  );

  log.info("event.address, {}", [event.address.toHex()]);

  internalTransfer(
    event.block.timestamp.toString(),
    event.address,
    event.params.member,
    event.params.tokenAddr
  );
}

// event Withdraw(address member, address tokenAddr, uint256 amount);
export function handleWithdraw(event: Withdraw): void {
  log.info(
    "================ Withdraw event fired. account {}, tokenAddr {}, amount {}",
    [
      event.params.account.toHexString(),
      event.params.tokenAddr.toHexString(),
      event.params.amount.toString(),
    ]
  );

  internalTransfer(
    "",
    event.address,
    event.params.account,
    event.params.tokenAddr
  );
}
