import torch
import torch.nn as nn
import argparse
import os

def convert_pth_to_onnx(pth_path, onnx_path):
    print(f"Loading model from {pth_path}...")
    try:
        # Load the state dict
        state_dict = torch.load(pth_path, map_location='cpu', weights_only=False)
        
        # Check if it's a full model or just weights
        if isinstance(state_dict, dict) and 'conv.weight' in state_dict:
            # It's likely just the weights dictionary as used in the notebook
            # The notebook extracts 'conv.weight' directly.
            # To export to ONNX, we need a PyTorch model.
            # Let's create a dummy model that matches the shape.
            
            conv_weight = state_dict['conv.weight']
            print(f"Found 'conv.weight' with shape: {conv_weight.shape}")
            
            # Assuming shape is (OutChannels, InChannels, Length) or similar
            # The notebook treats it as (N, 4, L)
            out_channels, in_channels, kernel_size = conv_weight.shape
            
            class MotifModel(nn.Module):
                def __init__(self):
                    super(MotifModel, self).__init__()
                    self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, bias=False)
                    self.conv.weight.data = conv_weight
                    
                def forward(self, x):
                    return self.conv(x)
            
            model = MotifModel()
            model.eval()
            
            # Create dummy input
            # Input shape for Conv1d is (Batch, InChannels, Length)
            # We need a dummy input length that is at least the kernel size
            dummy_input = torch.randn(1, in_channels, kernel_size * 2)
            
            print(f"Exporting to {onnx_path}...")
            torch.onnx.export(
                model, 
                dummy_input, 
                onnx_path, 
                export_params=True,
                opset_version=11,
                do_constant_folding=True,
                input_names=['input'],
                output_names=['output'],
                dynamic_axes={'input': {0: 'batch_size', 2: 'length'}, 'output': {0: 'batch_size', 2: 'length'}}
            )
            print("Conversion complete.")
            
        elif isinstance(state_dict, nn.Module):
             # It's a full model
            model = state_dict
            model.eval()
            # We'd need to know the input shape to export... 
            # For now, let's assume the user is providing the weight dict as in the notebook example.
            print("Error: Full model export not fully supported without knowing input shape. Please provide state_dict with 'conv.weight'.")
            
        else:
            # Maybe it's a state dict but keys are different?
            print(f"Loaded object type: {type(state_dict)}")
            if isinstance(state_dict, dict):
                print(f"Keys: {state_dict.keys()}")
            print("Error: Could not find 'conv.weight' in the loaded file.")

    except Exception as e:
        print(f"Error converting model: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert PyTorch .pth (containing conv.weight) to .onnx")
    parser.add_argument("input", help="Input .pth file")
    parser.add_argument("output", help="Output .onnx file")
    
    args = parser.parse_args()
    
    convert_pth_to_onnx(args.input, args.output)
