// Whole-script strict mode syntax
"use strict";

/**
MIT License

Copyright (c) 2020 Openlaw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
const {
  toBN,
  advanceTime,
  createDao,
  toUtf8,
  getContract,
  GUILD,
  SHARES,
  sharePrice,
  remaining,
  OLToken,
  numberOfShares,
  OnboardingContract,
  VotingContract,
  BankExtension,
  sha3,
  ETH_TOKEN,
} = require("../../utils/DaoFactory.js");
const { checkBalance, isActiveMember } = require("../../utils/TestUtils.js");

contract("MolochV3 - Onboarding Adapter", async (accounts) => {
  it("should not be possible onboard when the token amount exceeds the external token limits", async () => {
    const daoOwner = accounts[0];
    const applicant = accounts[2];

    // Issue OpenLaw ERC20 Basic Token for tests
    // Token supply higher than the limit for external tokens
    // defined in Bank._createNewAmountCheckpoint function (2**160-1).
    const supply = toBN("2").pow(toBN("180")).toString();
    const oltContract = await OLToken.new(supply, { from: daoOwner });
    const nbOfERC20Shares = 100000000;
    const erc20SharePrice = toBN("10");

    const dao = await createDao(
      daoOwner,
      erc20SharePrice,
      nbOfERC20Shares,
      10,
      1,
      oltContract.address
    );

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    // Transfer OLTs to myAccount
    // Use an amount that will cause an overflow 2**161 > 2**160-1 for external tokens
    const initialTokenBalance = toBN("2").pow(toBN("161")).toString();
    await oltContract.approve.sendTransaction(applicant, initialTokenBalance, {
      from: daoOwner,
    });
    await oltContract.transfer(applicant, initialTokenBalance, {
      from: daoOwner,
    });
    let applicantTokenBalance = await oltContract.balanceOf.call(applicant);
    assert.equal(
      initialTokenBalance.toString(),
      applicantTokenBalance.toString(),
      "applicant account must be initialized with 2**161 OLT Tokens"
    );

    // Pre-approve spender (onboarding adapter) to transfer proposer tokens
    // Higher than the current limit for external tokens: 2^160-1
    const tokenAmount = initialTokenBalance;
    await oltContract.approve.sendTransaction(
      onboarding.address,
      initialTokenBalance.toString(),
      {
        from: applicant,
        gasPrice: toBN("0"),
      }
    );

    const proposalId = "0x1";
    try {
      await onboarding.onboard(
        dao.address,
        proposalId,
        applicant,
        SHARES,
        tokenAmount,
        {
          from: applicant,
          gasPrice: toBN("0"),
        }
      );
      assert.fail("should not be possible to onboard");
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert"
      );

      // In case of failures the funds must be in the applicant account
      applicantTokenBalance = await oltContract.balanceOf.call(applicant);
      assert.equal(
        initialTokenBalance.toString(),
        applicantTokenBalance.toString(),
        "applicant account should contain 2**161 OLT Tokens when the onboard fails"
      );
    }
  });

  it("should be possible to join a DAO with ETH contribution", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    const nonMemberAccount = accounts[3];

    let dao = await createDao(myAccount);
    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);
    const voting = await getContract(dao, "voting", VotingContract);

    const myAccountInitialBalance = await web3.eth.getBalance(myAccount);
    // remaining amount to test sending back to proposer
    const ethAmount = sharePrice.mul(toBN(3)).add(remaining);

    await onboarding.onboard(dao.address, "0x1", applicant, SHARES, 0, {
      from: myAccount,
      value: ethAmount,
      gasPrice: toBN("0"),
    });

    // test return of remaining amount in excess of multiple of sharesPerChunk
    const myAccountBalance = await web3.eth.getBalance(myAccount);
    assert.equal(
      toBN(myAccountInitialBalance).sub(ethAmount).add(remaining).toString(),
      myAccountBalance.toString(),
      "myAccount did not receive remaining amount in excess of multiple of sharesPerChunk"
    );

    await onboarding.sponsorProposal(dao.address, "0x1", [], {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    await voting.submitVote(dao.address, "0x1", 1, {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    // should not be able to process before the voting period has ended
    try {
      await onboarding.processProposal(dao.address, "0x1", {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal has not been voted on yet");
    }

    await advanceTime(10000);
    await onboarding.processProposal(dao.address, "0x1", {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    const myAccountShares = await bank.balanceOf(myAccount, SHARES);
    const applicantShares = await bank.balanceOf(applicant, SHARES);
    const nonMemberAccountShares = await bank.balanceOf(
      nonMemberAccount,
      SHARES
    );
    assert.equal(myAccountShares.toString(), "1");
    assert.equal(
      applicantShares.toString(),
      numberOfShares.mul(toBN("3")).toString()
    );
    assert.equal(nonMemberAccountShares.toString(), "0");
    await checkBalance(bank, GUILD, ETH_TOKEN, sharePrice.mul(toBN("3")));

    // test active member status
    const applicantIsActiveMember = await isActiveMember(bank, applicant);
    assert.equal(applicantIsActiveMember, true);
    const nonMemberAccountIsActiveMember = await isActiveMember(
      bank,
      nonMemberAccount
    );
    assert.equal(nonMemberAccountIsActiveMember, false);
  });

  it("should be possible to join a DAO with ERC20 contribution", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    const nonMemberAccount = accounts[3];

    // Issue OpenLaw ERC20 Basic Token for tests
    const tokenSupply = 1000000;
    let oltContract = await OLToken.new(tokenSupply);

    const nbOfERC20Shares = 100000000;
    const erc20SharePrice = toBN("10");
    const erc20Remaining = erc20SharePrice.sub(toBN("1"));

    let dao = await createDao(
      myAccount,
      erc20SharePrice,
      nbOfERC20Shares,
      10,
      1,
      oltContract.address
    );

    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);
    const voting = await getContract(dao, "voting", VotingContract);

    // Transfer OLTs to myAccount
    const initialTokenBalance = toBN("100");
    await oltContract.transfer(myAccount, initialTokenBalance);
    let myAccountTokenBalance = await oltContract.balanceOf.call(myAccount);
    assert.equal(
      initialTokenBalance.toString(),
      myAccountTokenBalance.toString(),
      "myAccount must be initialized with 100 OLT Tokens"
    );

    // Total of OLTs to be sent to the DAO in order to get the shares
    // (remaining amount to test sending back to proposer)
    const tokenAmount = erc20SharePrice.add(toBN(erc20Remaining));

    try {
      await onboarding.onboard(
        dao.address,
        "0x1",
        applicant,
        SHARES,
        tokenAmount,
        {
          from: myAccount,
          gasPrice: toBN("0"),
        }
      );
      assert.fail("should have failed without spender approval!");
    } catch (err) {}

    // Pre-approve spender (onboarding adapter) to transfer proposer tokens
    await oltContract.approve(onboarding.address, tokenAmount, {
      from: myAccount,
    });

    await onboarding.onboard(
      dao.address,
      "0x1",
      applicant,
      SHARES,
      tokenAmount,
      {
        from: myAccount,
        gasPrice: toBN("0"),
      }
    );

    // test return of remaining amount in excess of multiple of sharesPerChunk
    myAccountTokenBalance = await oltContract.balanceOf.call(myAccount);
    assert.equal(
      initialTokenBalance.sub(tokenAmount).add(erc20Remaining).toString(),
      myAccountTokenBalance.toString(),
      "myAccount did not receive remaining amount in excess of multiple of sharesPerChunk"
    );

    await onboarding.sponsorProposal(dao.address, "0x1", [], {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    await voting.submitVote(dao.address, "0x1", 1, {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    // should not be able to process before the voting period has ended
    try {
      await onboarding.processProposal(dao.address, "0x1", {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal has not been voted on yet");
    }

    await advanceTime(10000);
    await onboarding.processProposal(dao.address, "0x1", {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    const myAccountShares = await bank.balanceOf(myAccount, SHARES);
    const applicantShares = await bank.balanceOf(applicant, SHARES);
    const nonMemberAccountShares = await bank.balanceOf(
      nonMemberAccount,
      SHARES
    );
    assert.equal(myAccountShares.toString(), "1");
    assert.equal(applicantShares.toString(), "100000000");
    assert.equal(nonMemberAccountShares.toString(), "0");
    await checkBalance(bank, GUILD, oltContract.address, "10");

    // test active member status
    const applicantIsActiveMember = await isActiveMember(bank, applicant);
    assert.equal(applicantIsActiveMember, true);
    const nonMemberAccountIsActiveMember = await isActiveMember(
      bank,
      nonMemberAccount
    );
    assert.equal(nonMemberAccountIsActiveMember, false);
  });

  it("should not be possible to have more than the maximum number of shares", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];

    let dao = await createDao(myAccount);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    try {
      await onboarding.onboard(dao.address, "0x1", applicant, SHARES, 0, {
        from: myAccount,
        value: sharePrice.mul(toBN(11)).add(remaining),
        gasPrice: toBN("0"),
      });
      assert.err("should not allow more than maxumum shared to be requested");
    } catch (err) {
      assert.equal(
        err.reason,
        "total shares for this member must be lower than the maximum"
      );
    }
  });

  it("should be possible to cancel an ETH onboarding proposal", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    let dao = await createDao(myAccount);

    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    const myAccountInitialBalance = await web3.eth.getBalance(myAccount);
    await onboarding.onboard(dao.address, "0x1", applicant, SHARES, 0, {
      from: myAccount,
      value: sharePrice.mul(toBN(3)).add(remaining),
      gasPrice: toBN("0"),
    });

    try {
      await onboarding.cancelProposal(dao.address, "0x1", {
        from: applicant,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "only proposer can cancel a proposal");
    }

    await onboarding.cancelProposal(dao.address, "0x1", {
      from: myAccount,
      gasPrice: toBN("0"),
    });
    const isProcessed = await dao.getProposalFlag("0x1", toBN("2")); // 2 is processed flag index
    assert.equal(isProcessed, true);

    // test refund of ETH contribution
    const myAccountBalance = await web3.eth.getBalance(myAccount);
    assert.equal(
      myAccountInitialBalance.toString(),
      myAccountBalance.toString(),
      "myAccount did not receive refund of ETH contribution"
    );

    // should not be able to sponsor if the proposal has already been cancelled
    try {
      await onboarding.sponsorProposal(dao.address, "0x1", [], {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal already processed");
    }

    // should not be able to process if the proposal has already been cancelled
    try {
      await onboarding.processProposal(dao.address, "0x1", {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal already processed");
    }

    const myAccountShares = await bank.balanceOf(myAccount, SHARES);
    const applicantShares = await bank.balanceOf(applicant, SHARES);
    assert.equal(myAccountShares.toString(), "1");
    assert.equal(applicantShares.toString(), "0");

    const guildBalance = await bank.balanceOf(GUILD, ETH_TOKEN);
    assert.equal(guildBalance.toString(), "0");
  });

  it("should be possible to cancel an ERC20 onboarding proposal", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];

    // Issue OpenLaw ERC20 Basic Token for tests
    const tokenSupply = 1000000;
    let oltContract = await OLToken.new(tokenSupply);

    const nbOfERC20Shares = 100000000;
    const erc20SharePrice = toBN("10");
    const erc20Remaining = erc20SharePrice.sub(toBN("1"));

    let dao = await createDao(
      myAccount,
      erc20SharePrice,
      nbOfERC20Shares,
      10,
      1,
      oltContract.address
    );

    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    // Transfer OLTs to myAccount
    const initialTokenBalance = toBN("100");
    await oltContract.transfer(myAccount, initialTokenBalance);
    let myAccountTokenBalance = await oltContract.balanceOf.call(myAccount);
    assert.equal(
      initialTokenBalance.toString(),
      myAccountTokenBalance.toString(),
      "myAccount must be initialized with 100 OLT Tokens"
    );

    // Total of OLTs to be sent to the DAO in order to get the shares
    const tokenAmount = erc20SharePrice.add(toBN(erc20Remaining));

    // Pre-approve spender (onboarding adapter) to transfer proposer tokens
    await oltContract.approve(onboarding.address, tokenAmount, {
      from: myAccount,
    });

    await onboarding.onboard(
      dao.address,
      "0x1",
      applicant,
      SHARES,
      tokenAmount,
      {
        from: myAccount,
        gasPrice: toBN("0"),
      }
    );

    try {
      await onboarding.cancelProposal(dao.address, "0x1", {
        from: applicant,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "only proposer can cancel a proposal");
    }

    await onboarding.cancelProposal(dao.address, "0x1", {
      from: myAccount,
      gasPrice: toBN("0"),
    });
    const isProcessed = await dao.getProposalFlag("0x1", toBN("2")); // 2 is processed flag index
    assert.equal(isProcessed, true);

    // test refund of ERC20 contribution
    myAccountTokenBalance = await oltContract.balanceOf.call(myAccount);
    assert.equal(
      initialTokenBalance.toString(),
      myAccountTokenBalance.toString(),
      "myAccount did not receive refund of ERC20 contribution"
    );

    // should not be able to sponsor if the proposal has already been cancelled
    try {
      await onboarding.sponsorProposal(dao.address, "0x1", [], {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal already processed");
    }

    // should not be able to process if the proposal has already been cancelled
    try {
      await onboarding.processProposal(dao.address, "0x1", {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal already processed");
    }

    const myAccountShares = await bank.balanceOf(myAccount, SHARES);
    const applicantShares = await bank.balanceOf(applicant, SHARES);
    assert.equal(myAccountShares.toString(), "1");
    assert.equal(applicantShares.toString(), "0");

    const guildBalance = await bank.balanceOf(GUILD, oltContract.address);
    assert.equal(guildBalance.toString(), "0");
  });

  it("should handle an onboarding proposal with a failed vote", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    let dao = await createDao(myAccount);

    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);
    const voting = await getContract(dao, "voting", VotingContract);

    const myAccountInitialBalance = await web3.eth.getBalance(myAccount);
    await onboarding.onboard(dao.address, "0x1", applicant, SHARES, 0, {
      from: myAccount,
      value: sharePrice.mul(toBN(3)).add(remaining),
      gasPrice: toBN("0"),
    });
    await onboarding.sponsorProposal(dao.address, "0x1", [], {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    await voting.submitVote(dao.address, "0x1", 2, {
      from: myAccount,
      gasPrice: toBN("0"),
    });
    await advanceTime(10000);
    const vote = await voting.voteResult(dao.address, "0x1");
    assert.equal(vote.toString(), "3"); // vote should be "not passed"

    await onboarding.processProposal(dao.address, "0x1", {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    const isProcessed = await dao.getProposalFlag("0x1", toBN("2")); // 2 is processed flag index
    assert.equal(isProcessed, true);

    // test refund of ETH contribution
    const myAccountBalance = await web3.eth.getBalance(myAccount);
    assert.equal(
      myAccountInitialBalance.toString(),
      myAccountBalance.toString(),
      "myAccount did not receive refund of ETH contribution"
    );

    const myAccountShares = await bank.balanceOf(myAccount, SHARES);
    const applicantShares = await bank.balanceOf(applicant, SHARES);
    assert.equal(myAccountShares.toString(), "1");
    assert.equal(applicantShares.toString(), "0");

    const guildBalance = await bank.balanceOf(GUILD, ETH_TOKEN);
    assert.equal(guildBalance.toString(), "0");

    const applicantBalance = await bank.balanceOf(applicant, ETH_TOKEN);
    assert.equal(applicantBalance.toString(), "0");

    const onboardingBalance = await web3.eth.getBalance(onboarding.address);
    assert.equal(onboardingBalance.toString(), "0");

    // test active member status
    const applicantIsActiveMember = await isActiveMember(bank, applicant);
    assert.equal(applicantIsActiveMember, false);
  });

  it("should not be possible to sponsor proposal that does not exist", async () => {
    const myAccount = accounts[1];
    let dao = await createDao(myAccount);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    try {
      await onboarding.sponsorProposal(dao.address, "0x1", [], {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal does not exist for this dao");
    }
  });

  it("should not be possible to process proposal that does not exist", async () => {
    const myAccount = accounts[1];
    let dao = await createDao(myAccount);

    const onboarding = await getContract(dao, "onboarding", OnboardingContract);

    try {
      await onboarding.processProposal(dao.address, "0x1", {
        from: myAccount,
        gasPrice: toBN("0"),
      });
    } catch (err) {
      assert.equal(err.reason, "proposal does not exist");
    }
  });

  it("should be possible to update delegate key and the member continues as an active member", async () => {
    const myAccount = accounts[1];
    const delegateKey = accounts[2];
    let dao = await createDao(myAccount);

    const onboardingAddr = await dao.getAdapterAddress(sha3("onboarding"));
    const onboarding = await OnboardingContract.at(onboardingAddr);
    const bankAddress = await dao.getExtensionAddress(sha3("bank"));
    const bank = await BankExtension.at(bankAddress);

    const myAccountActive1 = await isActiveMember(bank, myAccount);
    const delegateKeyActive1 = await dao.isActiveMember(delegateKey); // use the dao to check delegatedKeys

    assert.equal(true, myAccountActive1);
    assert.equal(false, delegateKeyActive1);

    const newDelegatedKey = accounts[9];
    await onboarding.updateDelegateKey(dao.address, newDelegatedKey, {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    assert.equal(true, await isActiveMember(bank, myAccount));
    assert.equal(true, await dao.isActiveMember(newDelegatedKey)); // use the dao to check delegatedKeys
  });

  it("should not be possible to overwrite a delegated key", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    let dao = await createDao(myAccount);

    const onboardingAddr = await dao.getAdapterAddress(sha3("onboarding"));
    const onboarding = await OnboardingContract.at(onboardingAddr);

    const proposalId = "0x1";

    await onboarding.onboard(dao.address, proposalId, applicant, SHARES, 1, {
      from: myAccount,
      value: sharePrice.mul(toBN(3)).add(remaining),
      gasPrice: toBN("0"),
    });

    try {
      // try to update the delegated key using the address of another member
      await onboarding.updateDelegateKey(dao.address, applicant, {
        from: myAccount,
        gasPrice: toBN("0"),
      });
      assert.fail("should not be possible to update the delegate key");
    } catch (e) {
      assert.equal(e.reason, "cannot overwrite existing delegated keys");
    }
  });

  it("should not be possible to update delegate key if the address is already taken as delegated key", async () => {
    const myAccount = accounts[1];
    const applicant = accounts[2];
    let dao = await createDao(myAccount);

    const onboardingAddr = await dao.getAdapterAddress(sha3("onboarding"));
    const onboarding = await OnboardingContract.at(onboardingAddr);

    const proposalId = "0x1";

    await onboarding.onboard(dao.address, proposalId, applicant, SHARES, 1, {
      from: myAccount,
      value: sharePrice.mul(toBN(3)).add(remaining),
      gasPrice: toBN("0"),
    });
    await onboarding.sponsorProposal(dao.address, proposalId, [], {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    const voting = await getContract(dao, "voting", VotingContract);
    await voting.submitVote(dao.address, proposalId, 1, {
      from: myAccount,
      gasPrice: toBN("0"),
    });
    await advanceTime(10000);
    const vote = await voting.voteResult(dao.address, proposalId);
    assert.equal(vote.toString(), "2"); // vote pass

    await onboarding.processProposal(dao.address, proposalId, {
      from: myAccount,
      gasPrice: toBN("0"),
    });

    try {
      // try to update the delegated key using the same address as the member address
      await onboarding.updateDelegateKey(dao.address, applicant, {
        from: applicant,
        gasPrice: toBN("0"),
      });
      assert.fail("should not be possible to update the delegate key");
    } catch (e) {
      assert.equal(e.reason, "address already taken as delegated key");
    }
  });
});
