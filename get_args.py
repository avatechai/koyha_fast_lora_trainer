import kohya_ss.train_network as train_network
import json
parser = train_network.setup_parser()

# Assuming parser is your ArgumentParser
type_mapping = {
    str: 'string',
    int: 'int',
    float: 'float',
    bool: 'bool',
    # Add more types if needed
}

# Assuming parser is your ArgumentParser
args_dict = {
    action.dest: {
        'help': action.help,
        'type': type_mapping.get(action.type, 'unknown') if action.type else None,
        'default': action.default,
        'choices': action.choices,
        'action': str(action.__class__.__name__)
    } for action in parser._actions if action.dest != 'help'
}
args_json = json.dumps(args_dict)
print(args_json)

with open('args/train_network_args.json', 'w') as f:
    json.dump(args_dict, f, ensure_ascii=False, indent=4)