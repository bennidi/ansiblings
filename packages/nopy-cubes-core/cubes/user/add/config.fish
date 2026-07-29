if status is-interactive
    # Commands to run in interactive sessions can go here
    # Execute all scripts in ~/.config/fish/rc/ on shell startup
    for script in ~/.config/fish/rc/*.fish
        if test -f $script
            source $script
        end
    end
end

