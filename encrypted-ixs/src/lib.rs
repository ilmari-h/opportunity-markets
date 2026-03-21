use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // Only the selected option is encrypted
    #[derive(Clone, Copy)]
    pub struct SelectedOption {
        pub selected_option: u64,
    }

    // Stake: encrypt the selected option for MXE storage and authorized reader disclosure
    #[instruction]
    pub fn stake(
        input_ctx: Enc<Shared, SelectedOption>,
        stake_recipient_ctx: Shared,
        stake_account_ctx: Shared,
    ) -> (
        Enc<Shared, SelectedOption>,  // stake data for MXE storage
        Enc<Shared, SelectedOption>,  // stake data for disclosure
    ) {
        let input = input_ctx.to_arcis();
        (
            stake_account_ctx.from_arcis(input),
            stake_recipient_ctx.from_arcis(input),
        )
    }

    // Reveal stake: decrypt option from stake account
    #[instruction]
    pub fn reveal_stake(
        stake_account_ctx: Enc<Shared, SelectedOption>,
    ) -> u64 {
        let stake_data = stake_account_ctx.to_arcis();
        stake_data.selected_option.reveal()
    }
}
