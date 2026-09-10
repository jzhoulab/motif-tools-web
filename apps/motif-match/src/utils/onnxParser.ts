import protobuf from 'protobufjs';

// We need the ONNX proto definition. 
// Since we can't easily fetch it at runtime without a server, 
// and bundling the whole proto file is tricky with pure protobufjs in browser without build steps,
// we will use a minimal JSON descriptor or try to load it if possible.
// Alternatively, we can use 'onnx-proto' package but it might be heavy.
// Let's try to use a pre-compiled JSON descriptor or a minimal definition.

// Actually, for this specific task of extracting weights, we just need to read the ModelProto -> GraphProto -> Initializer.
// Let's define a minimal proto structure for what we need.

const ONNX_PROTO = `
syntax = "proto3";

package onnx;

message ModelProto {
    int64 ir_version = 1;
    GraphProto graph = 7;
}

message GraphProto {
    repeated TensorProto initializer = 5;
    repeated NodeProto node = 10;
    repeated ValueInfoProto input = 11;
    repeated ValueInfoProto output = 12;
}

message NodeProto {
    repeated string input = 1;
    repeated string output = 2;
    string name = 3;
    string op_type = 4;
    repeated AttributeProto attribute = 5;
}

message AttributeProto {
    string name = 1;
    float f = 2;
    int64 i = 3;
    string s = 4;
    TensorProto t = 5;
    repeated float floats = 6;
    repeated int64 ints = 7;
    repeated string strings = 8;
    repeated TensorProto tensors = 9;
}

message ValueInfoProto {
    string name = 1;
    TypeProto type = 2;
}

message TypeProto {
    TensorTypeProto tensor_type = 1;
}

message TensorTypeProto {
    int32 elem_type = 1;
    TensorShapeProto shape = 2;
}

message TensorShapeProto {
    repeated Dimension dim = 1;
    message Dimension {
        oneof value {
            int64 dim_value = 1;
            string dim_param = 2;
        }
    }
}

message TensorProto {
    repeated int64 dims = 1;
    int32 data_type = 2;
    string name = 4;
    bytes raw_data = 9;
    repeated float float_data = 10;
    repeated int32 int32_data = 11;
    repeated int64 int64_data = 12;
}
`;

export async function parseOnnxWeights(fileOrBuffer: File | ArrayBuffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const processBuffer = (buffer: ArrayBuffer) => {
            try {
                const root = protobuf.parse(ONNX_PROTO).root;
                const ModelProto = root.lookupType("onnx.ModelProto");

                const message = ModelProto.decode(new Uint8Array(buffer));
                const object = ModelProto.toObject(message, {
                    longs: String,
                    enums: String,
                    bytes: String,
                });

                const weights: any[] = [];

                if (object.graph && object.graph.initializer) {
                    for (const tensor of object.graph.initializer) {
                        // We are looking for 4D tensors (filters) usually: (Out, In, H, W) or (Out, In, L)
                        // In our case (Out, In, L) -> 3 dims for Conv1d

                        // Check dims
                        if (tensor.dims && (tensor.dims.length === 3 || tensor.dims.length === 4)) {
                            // Decode data
                            let data: Float32Array | null = null;

                            if (tensor.rawData) {
                                // rawData is base64 string in toObject output usually? 
                                // Wait, protobufjs toObject with bytes:String returns base64.
                                // We need to decode it.
                                const binaryString = atob(tensor.rawData);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                // Assuming float32 (data_type = 1)
                                if (tensor.dataType === 1) {
                                    data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
                                }
                            } else if (tensor.floatData && tensor.floatData.length > 0) {
                                data = new Float32Array(tensor.floatData);
                            }

                            if (data) {
                                weights.push({
                                    name: tensor.name,
                                    dims: tensor.dims,
                                    data: data
                                });
                            }
                        }
                    }
                }

                resolve(weights);
            } catch (err) {
                reject(err);
            }
        };

        if (fileOrBuffer instanceof ArrayBuffer) {
            processBuffer(fileOrBuffer);
        } else {
            const reader = new FileReader();
            reader.onload = () => processBuffer(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(fileOrBuffer);
        }
    });
}
