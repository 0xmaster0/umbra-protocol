// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./ERC20.sol";

contract TestToken is ERC20 {
  constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

  function mint(address account, uint256 amount) public {
    _mint(account, amount);
  }
}
